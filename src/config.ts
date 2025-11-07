import * as dotenv from "dotenv";

dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.SPOTIFY_REDIRECT_URI ??
      "https://84f9ce2044aa.ngrok-free.app/auth/callback",
  },
  port: process.env.PORT ?? "3000",
};
