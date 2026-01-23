import * as dotenv from "dotenv";

dotenv.config();

export const config = {
  isDev: process.env.NODE_ENV !== "production",
  botToken: process.env.BOT_TOKEN ?? "",
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "tunehoard_bot",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  telegramMode: process.env.TELEGRAM_MODE ?? "polling",
  botWebhookSecretPath: process.env.BOT_WEBHOOK_SECRET_PATH ?? "telegram-hook",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-in-prod",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  },
  port: process.env.PORT ?? "3000",
  server: {
    protocol: process.env.SERVER_PROTOCOL ?? "http",
    host: process.env.SERVER_HOST ?? "localhost:3000",
  },
};
