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

const logger = pino({ level: "silent" });
const usingPairingCode = config.LOGIN_METHOD === "pairing";

function askQuestion(query) {
  return new Promise((resolve) => {
    // Non-interactive environments (Render, Railway, etc.) cannot answer prompts.
    if (!process.stdin.isTTY) {
      const fallback = process.env.PAIRING_NUMBER || config.OWNER_NUMBER;
      const digits = fallback ? fallback.replace(/\D/g, "") : "";
      if (digits.length >= 10) {
        console.log(`[Non-interactive mode] Using PAIRING_NUMBER / OWNER_NUMBER: ${digits}`);
        resolve(digits);
      } else {
        console.log("[Non-interactive mode] No PAIRING_NUMBER env var set and no valid OWNER_NUMBER in config.");
        console.log("Hint: set PAIRING_NUMBER env var or switch to LOGIN_METHOD=qr");
        resolve("");
      }
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    markOnlineOnConnect: false,
    browser: usingPairingCode ? Browsers.macOS("Desktop") : Browsers.baileys("Chrome"),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
  });

  if (usingPairingCode && !sock.authState.creds.registered) {
    let number = "";
    while (!number) {
      const answer = await askQuestion("Enter the WhatsApp number to link (with country code, no '+'): ");
      number = answer.replace(/\D/g, "");
      if (!number) {
        console.log("That doesn't look like a number — digits only, e.g. 254712345678.");
        // Prevent infinite loops in non-interactive environments
        if (!process.stdin.isTTY) {
          console.log("Exiting — cannot prompt in non-interactive environment.");
          process.exit(1);
        }
      }
    }

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
        console.error("Failed to request pairing code:", err.message || err);
      }
    };

    setTimeout(() => {
      requestPairingCode();
      renewalTimer = setInterval(requestPairingCode, 60_000);
    }, 3000);

    sock.ev.on("connection.update", ({ connection }) => {
      if (connection === "open") {
        connected = true;
        if (renewalTimer) clearInterval(renewalTimer);
      }
    });
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usingPairingCode) {
      console.log("Scan this QR code with WhatsApp (Linked Devices):");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed.", statusCode, "Reconnecting:", shouldReconnect);
      if (shouldReconnect) {
        // Small delay avoids tight reconnection loops
        setTimeout(() => startBot(), 3000);
      }
    } else if (connection === "open") {
      console.log(`${config.BOT_NAME} connected.`);
      keepAlwaysOnline(sock);
    }
  });

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

      messageStore.remember(chatId, msg.key.id, {
        content: msg.message,
        sender: msg.key.participant || msg.key.remoteJid,
        timestamp: msg.messageTimestamp,
      });

      if (msg.key.fromMe) continue;

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
    try {
      const chatId = msg.key.remoteJid;
      const deletedId = protocolMsg.key.id;
      const original = messageStore.recall(chatId, deletedId);
      if (!original) return;

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
    } catch (err) {
      console.error("Anti-delete error:", err.message || err);
    }
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

      case "groupinfo": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        try {
          const info = await groupMenu.handleGroupInfo(sock, chatId);
          return sock.sendMessage(chatId, { text: info });
        } catch (e) {
          return sock.sendMessage(chatId, { text: "Failed to fetch group info." });
        }
      }

      case "listmembers": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        try {
          const list = await groupMenu.handleListMembers(sock, chatId);
          return sock.sendMessage(chatId, { text: list });
        } catch (e) {
          return sock.sendMessage(chatId, { text: "Failed to list members." });
        }
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
        try {
          if (!(await groupMenu.isBotAdmin(sock, chatId))) {
            return sock.sendMessage(chatId, { text: "The linked account must be a group admin to add members." });
          }
        } catch (e) {
          return sock.sendMessage(chatId, { text: "Could not verify admin status." });
        }
        if (!argText) return sock.sendMessage(chatId, { text: `Usage: ${config.COMMAND_PREFIX}add 2547XXXXXXXX` });
        try {
          await groupMenu.handleAdd(sock, chatId, argText);
          return sock.sendMessage(chatId, { text: `Add request sent for ${argText.replace(/\D/g, "")}.` });
        } catch (e) {
          return sock.sendMessage(chatId, { text: "Failed to add member." });
        }
      }

      case "kick": {
        if (!isGroup) return sock.sendMessage(chatId, { text: "This command only works in groups." });
        try {
          if (!(await groupMenu.isBotAdmin(sock, chatId))) {
            return sock.sendMessage(chatId, { text: "The linked account must be a group admin to kick members." });
          }
        } catch (e) {
          return sock.sendMessage(chatId, { text: "Could not verify admin status." });
        }
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (!mentioned.length) return sock.sendMessage(chatId, { text: `Usage: ${config.COMMAND_PREFIX}kick @member (mention them)` });
        try {
          await groupMenu.handleKick(sock, chatId, mentioned[0]);
          return sock.sendMessage(chatId, { text: `Removed ${mentioned[0].split("@")[0]}.` });
        } catch (e) {
          return sock.sendMessage(chatId, { text: "Failed to remove member." });
        }
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
