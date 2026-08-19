module.exports = {
  BOT_NAME: "MARV-C V1",
  OWNER_NAME: "Marv C",
  OWNER_NUMBER: "254759083715", // stored without '+' — Baileys JIDs use country code + number
  BOT_INFO: "Marv C is a simple whatsapp assistant that help with small tasks",
  REPO_URL: "https://github.com/YOUR-USERNAME/marv-c-v1", // update after you push your own repo
  COMMAND_PREFIX: ".",
  TYPING_DURATION_MS: 15000, // 15 seconds of "typing..." after receiving a message
  SESSION_DIR: "./data/session",
  ANTIDELETE_STORE: "./data/antidelete_store.json",

  // ----- linking -----
  // "pairing" = link with an 8-character pairing code (no QR scan needed).
  // The bot will ask you to type in the number to link every time it needs
  // one — on purpose, so a code is never generated without you explicitly
  // handing over that number in the moment. "qr" = old-style
  // QR-code-in-terminal linking.
  LOGIN_METHOD: process.env.LOGIN_METHOD || "pairing",
};
