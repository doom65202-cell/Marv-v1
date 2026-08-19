const config = require("../config");
const { getUptimeString } = require("../lib/uptime");
const { isAntideleteEnabled, setAntidelete } = require("../lib/messageStore");

// Native WhatsApp "interactive buttons" are unreliable on the multi-device
// protocol these days (many clients silently drop them), so the menu is a
// plain numbered/worded list. Each option is just another "." command,
// which behaves the same as tapping a button would.
function mainMenuText() {
  return (
`*${config.BOT_NAME} AUTOMATION*
_____________________________________
*Menu 1: Main menu*
_____________________________________
Reply with any of the commands below:

1. ${config.COMMAND_PREFIX}uptime   - bot uptime
2. ${config.COMMAND_PREFIX}owner    - owner info
3. ${config.COMMAND_PREFIX}botinfo  - about this bot
4. ${config.COMMAND_PREFIX}repo     - github repository link
5. ${config.COMMAND_PREFIX}sc       - repo + owner info + a tag
6. ${config.COMMAND_PREFIX}antidelete on/off - toggle anti-delete

Type *${config.COMMAND_PREFIX}groupmenu* for group-only commands.`
  );
}

function ownerText() {
  return `*Owner:* ${config.OWNER_NAME}\n*WhatsApp:* +${config.OWNER_NUMBER}`;
}

function botInfoText() {
  return `*${config.BOT_NAME}*\n${config.BOT_INFO}`;
}

function repoText() {
  return `*Repository:*\n${config.REPO_URL}`;
}

function scText() {
  return (
`${repoText()}

${ownerText()}

Enjoy 🎉`
  );
}

function uptimeText() {
  return `*Uptime:* ${getUptimeString()}`;
}

// arg is whatever follows ".antidelete", e.g. "on" or "off"
function antideleteText(arg) {
  const normalized = (arg || "").trim().toLowerCase();
  if (normalized !== "on" && normalized !== "off") {
    return `Usage: ${config.COMMAND_PREFIX}antidelete on  |  ${config.COMMAND_PREFIX}antidelete off\nCurrently: *${isAntideleteEnabled() ? "ON" : "OFF"}*`;
  }
  const enabled = setAntidelete(normalized === "on");
  return `Anti-delete is now *${enabled ? "ON" : "OFF"}*.`;
}

module.exports = {
  mainMenuText,
  ownerText,
  botInfoText,
  repoText,
  scText,
  uptimeText,
  antideleteText,
};
