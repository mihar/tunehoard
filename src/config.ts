import * as dotenv from "dotenv";

dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  telegramMode: process.env.TELEGRAM_MODE ?? "polling",
  botWebhookSecretPath: process.env.BOT_WEBHOOK_SECRET_PATH ?? "telegram-hook",
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
