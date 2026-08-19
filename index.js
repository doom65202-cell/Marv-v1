const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  Browsers,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const readline = require("readline");

const config = require("./config");
const messageStore = require("./lib/messageStore");
const mainMenu = require("./commands/mainMenu");
const groupMenu = require("./commands/groupMenu");
const { startKeepAliveServer } = require("./lib/uptime");

const logger = pino({ level: "silent" }); // set to "info" while debugging
const usingPairingCode = config.LOGIN_METHOD === "pairing";

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    // We drive "online" presence manually (see below) rather than letting
    // Baileys mark us online only while actively connected.
    markOnlineOnConnect: false,
    // Pairing codes only work reliably when Baileys presents itself as a
    // real browser rather than the default "Baileys" fingerprint.
    browser: usingPairingCode ? Browsers.macOS("Desktop") : Browsers.baileys("Chrome"),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
  });

  // Request a pairing code once, right after the socket is created, if
  // we're not already linked. Only needed for the very first run — once
  // creds.update has fired and saved a registered session, this is skipped
  // on subsequent restarts.
  if (usingPairingCode && !sock.authState.creds.registered) {
    // Always ask — on purpose. We don't silently fall back to a number
    // baked into config.js or an env var, because a pairing code request
    // reveals whether that number has WhatsApp and can be used to spam it
    // with link requests. Typing it in each time means a code is only ever
    // generated for a number you explicitly hand over right now.
    let number = "";
    while (!number) {
      const answer = await askQuestion("Enter the WhatsApp number to link (with country code, no '+'): ");
      number = answer.replace(/\D/g, "");
      if (!number) console.log("That doesn't look like a number — digits only, e.g. 254712345678.");
    }

    // Whatever number you just handed over is the account the bot will
    // actually run as once linked, so treat it as the owner/operating
    // number from here on — admin checks, "owner" replies, and anti-delete
    // DMs all follow this number instead of whatever was hardcoded in
    // config.js.
    config.OWNER_NUMBER = number;

    let connected = false;
    let renewalTimer = null;

    const requestPairingCode = async () => {
      if (connected) return;
      try {
        const code = await sock.requestPairingCode(number);
        console.log("\n===============================");
        console.log(`  Pairing code: ${code}`);
        console.log("===============================");
        console.log("On the phone number above: WhatsApp → Settings → Linked Devices →");
        console.log("Link a Device → Link with phone number instead → enter this code.");
        console.log("Not connected within 1 minute? A fresh code is generated automatically.\n");
      } catch (err) {
        console.error("Failed to request pairing code:", err);
      }
    };

    // Small delay avoids a race where the socket isn't fully ready yet.
    setTimeout(() => {
      requestPairingCode();
      // Pairing codes expire quickly. Keep issuing a new one every 60s
      // for as long as we're still waiting to connect.
      renewalTimer = setInterval(requestPairingCode, 60_000);
    }, 3000);

    // Stop renewing once we're actually linked and connected.
    sock.ev.on("connection.update", ({ connection }) => {
      if (connection === "open") {
        connected = true;
        if (renewalTimer) clearInterval(renewalTimer);
      }
    });
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usingPairingCode) {
      console.log("Scan this QR code with WhatsApp (Linked Devices):");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed.", statusCode, "Reconnecting:", shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log(`${config.BOT_NAME} connected.`);
      keepAlwaysOnline(sock);
    }
  });

  // "Indicate I'm online always even when I'm offline" — we periodically
  // (re)send an 'available' presence broadcast. WhatsApp shows "online"
  // based on the last presence it received, so refreshing this keeps the
  // linked number appearing online even if this process's device session
  // is otherwise idle.
  function keepAlwaysOnline(sock) {
    sock.sendPresenceUpdate("available").catch(() => {});
    setInterval(() => {
      sock.sendPresenceUpdate("available").catch(() => {});
    }, 25_000);
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;

      // Anti-delete detection: WhatsApp signals a "delete for everyone"
      // as a protocolMessage of type REVOKE referencing the original key.
      const protocolMsg = msg.message.protocolMessage;
      if (protocolMsg && protocolMsg.type === 0 /* REVOKE */) {
        await handleRevoke(sock, msg, protocolMsg);
        continue;
      }

      const chatId = msg.key.remoteJid;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      // Remember every message so we can recover it later if it's deleted.
      messageStore.remember(chatId, msg.key.id, {
        content: msg.message,
        sender: msg.key.participant || msg.key.remoteJid,
        timestamp: msg.messageTimestamp,
      });

      if (msg.key.fromMe) continue; // don't reply to our own messages

      // "Typing..." indicator for ~15s after receiving any message
      showTypingThenPause(sock, chatId);

      if (!text.startsWith(config.COMMAND_PREFIX)) continue;
      await routeCommand(sock, msg, chatId, text);
    }
  });

  async function showTypingThenPause(sock, chatId) {
    try {
      await sock.sendPresenceUpdate("composing", chatId);
      setTimeout(() => {
        sock.sendPresenceUpdate("paused", chatId).catch(() => {});
      }, config.TYPING_DURATION_MS);
    } catch {
      /* ignore presence errors */
    }
  }

  async function handleRevoke(sock, msg, protocolMsg) {
    if (!messageStore.isAntideleteEnabled()) return;

    const chatId = msg.key.remoteJid;
    const deletedId = protocolMsg.key.id;
    const original = messageStore.recall(chatId, deletedId);
    if (!original) return; // nothing cached (e.g. sent before bot started)

    const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
    const originalText =
      original.content.conversation ||
      original.content.extendedTextMessage?.text ||
      original.content.imageMessage?.caption ||
      "(non-text message)";

    await sock.sendMessage(ownerJid, {
      text:
        `🗑️ *Deleted message recovered*\n` +
        `Chat: ${chatId}\n` +
        `From: ${original.sender}\n` +
        `Content: ${originalText}`,
    });
  }

  async function routeCommand(sock, msg, chatId, text) {
    const isGroup = chatId.endsWith("@g.us");
    const [rawCmd, ...rest] = text.slice(config.COMMAND_PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const argText = rest.join(" ");

    switch (cmd) {
      case "help":
      case "menu":
        return sock.sendMessage(chatId, { text: mainMenu.mainMenuText() });

      case "uptime":
        return sock.sendMessage(chatId, { text: mainMenu.uptimeText() });

      case "owner":
        return sock.sendMessage(chatId, { text: mainMenu.ownerText() });

      case "botinfo":
        return sock.sendMessage(chatId, { text: mainMenu.botInfoText() });

      case "repo":
        return sock.sendMessage(chatId, { text: mainMenu.repoText() });

      case "sc":
        return sock.sendMessage(chatId, { text: mainMenu.scText() });

      case "antidelete":
        return sock.sendMessage(chatId, { text: mainMenu.antideleteText(argText) });

      case "groupmenu":
        return sock.sendMessage(chatId, { text: groupMenu.groupMenuText() });

      // ----- group-only commands below -----
      case "groupinfo": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        const info = await groupMenu.handleGroupInfo(sock, chatId);
        return sock.sendMessage(chatId, { text: info });
      }

      case "listmembers": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        const list = await groupMenu.handleListMembers(sock, chatId);
        return sock.sendMessage(chatId, { text: list });
      }

      case "tag": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        return groupMenu.handleTag(sock, chatId, argText || "👋", mentioned);
      }

      case "tagall": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        return groupMenu.handleTagAll(sock, chatId, argText || "Attention everyone");
      }

      case "left": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        return groupMenu.handleLeft(sock, chatId);
      }

      case "add": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        if (!(await groupMenu.isBotAdmin(sock, chatId))) {
          return sock.sendMessage(chatId, { text: "The linked account must be a group admin to add members." });
        }
        if (!argText) return sock.sendMessage(chatId, { text: `Usage: ${config.COMMAND_PREFIX}add 2547XXXXXXXX` });
        await groupMenu.handleAdd(sock, chatId, argText);
        return sock.sendMessage(chatId, { text: `Add request sent for ${argText}.` });
      }

      case "kick": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        if (!(await groupMenu.isBotAdmin(sock, chatId))) {
          return sock.sendMessage(chatId, { text: "The linked account must be a group admin to kick members." });
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (!mentioned.length) return sock.sendMessage(chatId, { text: `Usage: ${config.COMMAND_PREFIX}kick @member (mention them)` });
        await groupMenu.handleKick(sock, chatId, mentioned[0]);
        return sock.sendMessage(chatId, { text: `Removed ${mentioned[0].split("@")[0]}.` });
      }

      default:
        return sock.sendMessage(chatId, {
          text: `Unknown command. Type ${config.COMMAND_PREFIX}menu to see what I can do.`,
        });
    }
  }
}

startKeepAliveServer();
startBot().catch((err) => console.error("Fatal error starting bot:", err));
