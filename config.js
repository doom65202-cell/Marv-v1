module.exports = {
  BOT_NAME: "MARV-C V1",
  OWNER_NAME: "Marv C",
  // Default owner number. On first interactive link this is overwritten.
  // For non-interactive hosts (Render, Railway, etc.) set PAIRING_NUMBER env var.
  OWNER_NUMBER: "254759083715",
  BOT_INFO: "Marv C is a simple whatsapp assistant that help with small tasks",
  REPO_URL: "https://github.com/YOUR-USERNAME/marv-c-v1",
  COMMAND_PREFIX: ".",
  TYPING_DURATION_MS: 15000,
  SESSION_DIR: "./data/session",
  ANTIDELETE_STORE: "./data/antidelete_store.json",

  // "pairing" = 8-char code (no QR scan). "qr" = terminal QR code.
  // Pairing on Render requires PAIRING_NUMBER env var or a valid OWNER_NUMBER above.
  LOGIN_METHOD: process.env.LOGIN_METHOD || "pairing",
};
