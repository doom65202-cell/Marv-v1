const config = require("../config");

function groupMenuText() {
  return (
`*${config.BOT_NAME} AUTOMATION*
_____________________________________
*Menu 2: Group menu*
_____________________________________
${config.COMMAND_PREFIX}groupinfo         - group details
${config.COMMAND_PREFIX}listmembers       - list all members
${config.COMMAND_PREFIX}tag <text>        - reply/tag a member (mention them in <text>)
${config.COMMAND_PREFIX}tagall <text>     - tag every member
${config.COMMAND_PREFIX}left              - bot account leaves the group

*Admin-only* (linked account must be a group admin):
${config.COMMAND_PREFIX}add <number>      - add a member
${config.COMMAND_PREFIX}kick <@mention>   - remove a member`
  );
}

// Returns true/false, checking whether the LINKED account (the bot's own
// number) is an admin of this group — required for kick/add per the spec.
async function isBotAdmin(sock, groupId) {
  const metadata = await sock.groupMetadata(groupId);
  const botId = sock.user.id.split(":")[0] + "@s.whatsapp.net";
  const me = metadata.participants.find((p) => p.id.includes(botId.split("@")[0]));
  return me?.admin === "admin" || me?.admin === "superadmin";
}

async function handleGroupInfo(sock, groupId) {
  const metadata = await sock.groupMetadata(groupId);
  const admins = metadata.participants.filter((p) => p.admin).map((p) => p.id.split("@")[0]);
  return (
`*Group Info*
Name: ${metadata.subject}
Members: ${metadata.participants.length}
Admins: ${admins.length ? admins.join(", ") : "none"}
Created: ${metadata.creation ? new Date(metadata.creation * 1000).toLocaleString() : "unknown"}
Description: ${metadata.desc || "none"}`
  );
}

async function handleListMembers(sock, groupId) {
  const metadata = await sock.groupMetadata(groupId);
  const lines = metadata.participants.map((p, i) => `${i + 1}. ${p.id.split("@")[0]}${p.admin ? " (admin)" : ""}`);
  return `*Members (${metadata.participants.length})*\n` + lines.join("\n");
}

// text should already contain the mention markup, e.g. "@2547..."
async function handleTag(sock, groupId, text, mentionedJids) {
  await sock.sendMessage(groupId, { text, mentions: mentionedJids });
}

async function handleTagAll(sock, groupId, text) {
  const metadata = await sock.groupMetadata(groupId);
  const mentions = metadata.participants.map((p) => p.id);
  const names = metadata.participants.map((p) => `@${p.id.split("@")[0]}`).join(" ");
  await sock.sendMessage(groupId, { text: `${text}\n\n${names}`, mentions });
}

async function handleLeft(sock, groupId) {
  await sock.groupLeave(groupId);
}

// number: raw digits e.g. "2547XXXXXXXX"
async function handleAdd(sock, groupId, number) {
  const jid = `${number.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
  return sock.groupParticipantsUpdate(groupId, [jid], "add");
}

async function handleKick(sock, groupId, jid) {
  return sock.groupParticipantsUpdate(groupId, [jid], "remove");
}

module.exports = {
  groupMenuText,
  isBotAdmin,
  handleGroupInfo,
  handleListMembers,
  handleTag,
  handleTagAll,
  handleLeft,
  handleAdd,
  handleKick,
};
