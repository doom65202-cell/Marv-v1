const fs = require("fs");
const path = require("path");
const config = require("../config");

// Keeps the last N messages per chat in memory so that when WhatsApp sends
// a "message revoked" (delete for everyone) protocol message, we can look up
// what the original content was and re-send it to the owner.
const MAX_PER_CHAT = 200;
const cache = new Map(); // chatId -> Map(msgId -> { content, sender, timestamp })

// Anti-delete on/off state, persisted to disk so it survives restarts.
let antideleteEnabled = loadToggleState();

function loadToggleState() {
  try {
    const raw = fs.readFileSync(config.ANTIDELETE_STORE, "utf8");
    return JSON.parse(raw).enabled === true;
  } catch {
    return false; // default off until the owner turns it on
  }
}

function saveToggleState() {
  fs.mkdirSync(path.dirname(config.ANTIDELETE_STORE), { recursive: true });
  fs.writeFileSync(
    config.ANTIDELETE_STORE,
    JSON.stringify({ enabled: antideleteEnabled }, null, 2)
  );
}

function isAntideleteEnabled() {
  return antideleteEnabled;
}

function setAntidelete(state) {
  antideleteEnabled = state;
  saveToggleState();
  return antideleteEnabled;
}

function remember(chatId, msgId, entry) {
  if (!cache.has(chatId)) cache.set(chatId, new Map());
  const chatMap = cache.get(chatId);
  chatMap.set(msgId, entry);
  if (chatMap.size > MAX_PER_CHAT) {
    const oldestKey = chatMap.keys().next().value;
    chatMap.delete(oldestKey);
  }
}

function recall(chatId, msgId) {
  return cache.get(chatId)?.get(msgId) || null;
}

module.exports = {
  remember,
  recall,
  isAntideleteEnabled,
  setAntidelete,
};
