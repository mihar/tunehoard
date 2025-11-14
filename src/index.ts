import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import express, { Request, Response } from "express";
import fetch from "node-fetch";
import * as path from "path";
import * as querystring from "querystring";
import {
  YoutubeService,
  SpotifyService,
  MusicService,
  DestinationService,
} from "./MusicService";
import Database from "./Database";
import { config } from "./config";

const BOT_TOKEN = config.botToken;
const SERVER_PORT = config.port;
const SERVER_PROTOCOL = config.server.protocol;
const SERVER_HOST = config.server.host;
const BASE_SERVER_URL = `${SERVER_PROTOCOL}://${SERVER_HOST}`;
const YOUTUBE_API_KEY = config.youtubeApiKey;
const SPOTIFY_CLIENT_ID = config.spotify.clientId;
const SPOTIFY_CLIENT_SECRET = config.spotify.clientSecret;
const SPOTIFY_REDIRECT_URI = `${BASE_SERVER_URL}/auth/callback`;

export interface UserData {
  telegramUserId: number;
  destinationService: DestinationService;
  accessToken: string;
  refreshToken: string;
  playlistId?: string;
}

const database = new Database<UserData>();

const bot = new Telegraf(BOT_TOKEN);

// Express server for Spotify OAuth + UI
const app = express();

MusicService.register("youtube", {
  matchUrl: YoutubeService.matchUrl,
  create: () => new YoutubeService({ apiKey: YOUTUBE_API_KEY }),
});

MusicService.register(DestinationService.SPOTIFY, {
  create: () => new SpotifyService({ apiKey: "TODO" }),
});

// We need body parsing for the /set_playlist endpoint
app.use(express.json());

// Serve static files (including index.html).
const staticRoot = path.resolve(__dirname, "../public");
app.use(express.static(staticRoot));

/**
 * Generate the Spotify OAuth login link, with 'state' = Telegram user ID
 */
function getSpotifyAuthLink(telegramUserId: number): string {
  const scopes = [
    "playlist-read-private",
    "playlist-modify-private",
    "playlist-modify-public",
  ].join(" ");

  const queryParams = querystring.stringify({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state: String(telegramUserId),
  });

  return `https://accounts.spotify.com/authorize?${queryParams}`;
}

/**
 * Kamal health check
 */
app.get("/up", (req: Request, res: Response) => {
  res.send("OK");
});

/**
 * /auth/login
 * Expects telegramUserId as a query param
 */
app.get("/auth/login", (req: Request, res: Response) => {
  const telegramUserId = Number(req.query.telegramUserId);
  if (!telegramUserId) {
    res.send("Missing or invalid telegramUserId.");
    return;
  }

  if (database.findById(telegramUserId)) {
    res.send("User already authenticated.");
    return;
  }

  res.redirect(getSpotifyAuthLink(telegramUserId));
});

/**
 * /auth/callback
 * Exchanges code for tokens, stores them
 */
app.get("/auth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code || !state) {
    res.send("Missing code or state.");
    return;
  }

  const telegramUserId = Number(state);
  if (!telegramUserId) {
    res.send("Invalid Telegram user ID in state.");
    return;
  }
  console.log(
    "/auth/callback: code =",
    code,
    "state =",
    state,
    "telegramUserId =",
    telegramUserId
  );

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
            "base64"
          ),
      },
      body: querystring.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      res.send(`Error retrieving tokens: ${tokenData.error}`);
      return;
    }

    database.insert({
      telegramUserId,
      destinationService: DestinationService.SPOTIFY,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    });

    // Redirect to UI (indicating success)
    res.redirect("/?connected=1");
  } catch (error) {
    console.error("Error exchanging Spotify code:", error);
    res.send("Error exchanging code for token.");
  }
});

/**
 * /playlists
 * Returns current user's playlists from Spotify
 */
app.get("/playlists", async (req: Request, res: Response) => {
  const telegramUserId = Number(req.query.telegramUserId);
  if (!telegramUserId) {
    res.status(400).send("Missing or invalid telegramUserId.");
    return;
  }

  const uData = database.findById(telegramUserId);
  if (!uData || !uData.accessToken) {
    res.status(401).send("User not authenticated with Spotify.");
    return;
  }

  try {
    const response = await fetch("https://api.spotify.com/v1/me/playlists", {
      headers: { Authorization: `Bearer ${uData.accessToken}` },
    });
    const data = await response.json();
    if (data.error) {
      res.status(500).send(data.error);
      return;
    }
    res.json(data);
  } catch (err) {
    console.error("Error fetching playlists:", err);
    res.status(500).send("Error fetching playlists.");
  }
});

/**
 * /create_playlist
 * Creates a new playlist for the logged in user
 */
app.post("/create_playlist", async (req: Request, res: Response) => {
  const telegramUserId = Number(req.query.telegramUserId);
  if (!telegramUserId) {
    res.status(400).send("Missing or invalid telegramUserId.");
    return;
  }

  const uData = database.findById(telegramUserId);
  if (!uData || !uData.accessToken) {
    res.status(401).send("User not authenticated with Spotify.");
    return;
  }

  const playlistName = "My Bot-Generated Playlist";
  try {
    // Get user profile (to find user ID)
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${uData.accessToken}` },
    });
    const meData = await meRes.json();

    // Create playlist
    const createRes = await fetch(
      `https://api.spotify.com/v1/users/${meData.id}/playlists`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${uData.accessToken}`,
        },
        body: JSON.stringify({
          name: playlistName,
          public: false,
        }),
      }
    );
    const createdPlaylist = await createRes.json();

    res.json(createdPlaylist);
  } catch (err) {
    console.error("Error creating playlist:", err);
    res.status(500).send("Error creating playlist.");
  }
});

/**
 * /set_playlist
 * Allows the UI to specify which playlist the user wants to use
 */
app.post("/set_playlist", async (req: Request, res: Response) => {
  // We can receive either query params or JSON body. Let's use JSON body for clarity.
  const { telegramUserId, playlistId } = req.body;
  if (!telegramUserId || !playlistId) {
    res.status(400).send("Missing telegramUserId or playlistId in body.");
    return;
  }

  const userEntry = database.findById(telegramUserId);
  if (!userEntry || !userEntry.accessToken) {
    res.status(404).send("User not found or not authenticated.");
    return;
  }

  userEntry.playlistId = playlistId;
  database.update(telegramUserId, userEntry);

  res.json({ message: "Playlist updated for user." });
});

/**
 * Start the Express server
 */
app.listen(SERVER_PORT, () => {
  console.log(
    `Express server listening on port ${SERVER_PORT}, database has ${
      database.findAll().length
    } users`
  );
});

/* --------------------------------------------------
   TELEGRAM BOT COMMANDS
   -------------------------------------------------- */

// /start
bot.command("start", async (ctx: Context) => {
  await ctx.reply(
    "Welcome! Use /login to connect your Spotify account. /help for commands."
  );
});

// /help
bot.command("help", async (ctx: Context) => {
  await ctx.reply(
    "Commands:\n" +
      "/start - Welcome\n" +
      "/login - Connect your Spotify\n" +
      "/disconnect - Disconnect your Spotify\n" +
      "/help - Show help\n"
  );
});

// /login
bot.command("login", async (ctx: Context) => {
  if (!ctx.from) return;
  const authUrl = `${BASE_SERVER_URL}/auth/login?telegramUserId=${ctx.from.id}`;
  await ctx.reply(`Click here to connect to Spotify:\n${authUrl}`);
});

// /disconnect
bot.command("disconnect", async (ctx: Context) => {
  if (!ctx.from) return;
  database.delete(ctx.from.id);
  await ctx.reply("Disconnected you from Spotify.");
});

// On any text message, look for YouTube or YT Music links
bot.on(message("text"), async (ctx) => {
  if (!ctx.from) return;
  const text = ctx.message.text;

  const resolvedService = MusicService.resolve(text);
  if (!resolvedService) {
    console.warn("No service found for URL", text);
    return;
  }

  const service = resolvedService.service;

  // Get the track information.
  const trackInfo = await service.getTrack(text);
  if (!trackInfo) {
    await ctx.reply(`Couldn't parse "Artist - Song"`);
    return;
  }
  console.log(trackInfo);

  for (const user of database.findAll()) {
    console.log("Adding track to playlist for user", user.telegramUserId);
    const uData = database.findById(user.telegramUserId);
    if (!uData || !uData.accessToken) continue; // no data for user

    if (uData.destinationService !== DestinationService.SPOTIFY) continue;
    if (!uData.playlistId) continue;

    const destinationService = MusicService.get(uData.destinationService);
    if (!destinationService) continue;

    console.log(
      "Adding track to playlist for user",
      user.telegramUserId,
      "using destination service",
      uData.destinationService
    );
    await destinationService.addToPlaylist({
      playlistId: uData.playlistId,
      trackInfo,
      accessToken: uData.accessToken,
    });
  }
});

// Bot errors
bot.catch((err) => {
  console.error("Telegram bot error:", err);
});

// Start the bot
bot
  .launch()
  .then(() => console.log("Telegram bot started..."))
  .catch(console.error);

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
