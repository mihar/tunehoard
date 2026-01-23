import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import express, { Request, Response } from "express";
import fetch from "node-fetch";
import * as path from "path";
import * as querystring from "querystring";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import {
  YoutubeService,
  SpotifyService,
  MusicService,
  DestinationService,
} from "./MusicService";
import { TrackTitleNormalizer } from "./TrackTitleNormalizer";
import { trackMatcher } from "./TrackMatcher";
import Database from "./Database";
import { config } from "./config";
import { log } from "./logger";

const BOT_TOKEN = config.botToken;
const SERVER_PORT = Number(config.port ?? 80);
const SERVER_PROTOCOL = config.server.protocol;
const SERVER_HOST = config.server.host;
const BASE_SERVER_URL =
  SERVER_PORT === 80 || SERVER_PORT === 443 || SERVER_PROTOCOL === "https"
    ? `${SERVER_PROTOCOL}://${SERVER_HOST}`
    : `${SERVER_PROTOCOL}://${SERVER_HOST}:${SERVER_PORT}`;
const YOUTUBE_API_KEY = config.youtubeApiKey;
const SPOTIFY_CLIENT_ID = config.spotify.clientId;
const SPOTIFY_CLIENT_SECRET = config.spotify.clientSecret;
const SPOTIFY_REDIRECT_URI = `${BASE_SERVER_URL}/auth/callback`;
const TELEGRAM_MODE = config.telegramMode;
const WEBHOOK_PATH = `/telegram/${config.botWebhookSecretPath}`;
const SESSION_SECRET = config.sessionSecret;
const IS_DEV = config.isDev;

// Chat-centric data model
export interface ServiceConnection {
  service: DestinationService;
  accessToken?: string;
  refreshToken?: string;
  playlistId?: string;
  tracksAdded?: number;
}

export interface ChatIntegration {
  id: number; // chatId - works for DM, group, channel (can be negative)
  chatType: "private" | "group" | "supergroup" | "channel";
  chatTitle?: string;
  connections: ServiceConnection[];
  smartMatching?: boolean;
  createdAt: string;
}

// JWT payload for auth links
interface ChatAuthPayload {
  chatId: number;
  chatType: string;
  chatTitle?: string;
  exp?: number;
}

// Session payload stored in cookie
interface SessionPayload {
  chatId: number;
  chatType: string;
  chatTitle?: string;
}

// Helper to get a specific service connection from a chat integration
function getConnection(
  integration: ChatIntegration,
  service: DestinationService
): ServiceConnection | undefined {
  return integration.connections.find((c) => c.service === service);
}

// Helper to set or update a service connection
function setConnection(
  integration: ChatIntegration,
  connection: ServiceConnection
): void {
  const existingIndex = integration.connections.findIndex(
    (c) => c.service === connection.service
  );
  if (existingIndex >= 0) {
    integration.connections[existingIndex] = connection;
  } else {
    integration.connections.push(connection);
  }
}

const chatDatabase = new Database<ChatIntegration>("storage/chats.jsonl");

const bot = new Telegraf(BOT_TOKEN);

// Express server for Spotify OAuth + UI
const app = express();
let httpServer: ReturnType<typeof app.listen> | null = null;

MusicService.register("youtube", {
  matchUrl: YoutubeService.matchUrl,
  create: () => new YoutubeService({ apiKey: YOUTUBE_API_KEY }),
});

MusicService.register(DestinationService.SPOTIFY, {
  create: () => new SpotifyService({ apiKey: "TODO" }),
});

app.use(express.json());
app.use(cookieParser());

/**
 * Generate a signed JWT for chat authentication (5 minute expiry)
 */
function createChatAuthToken(
  chatId: number,
  chatType: string,
  chatTitle?: string
): string {
  const payload: ChatAuthPayload = {
    chatId,
    chatType,
    chatTitle,
  };
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: "5m" });
}

/**
 * Verify the chat auth token from the login link
 */
function verifyChatAuthToken(token: string): ChatAuthPayload | null {
  try {
    return jwt.verify(token, SESSION_SECRET) as ChatAuthPayload;
  } catch {
    return null;
  }
}

/**
 * Create a session token (longer-lived, for cookie)
 */
function createSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: "30d" });
}

/**
 * Verify session cookie
 */
function verifySessionCookie(req: Request): SessionPayload | null {
  const token = req.cookies?.session;
  if (!token) return null;

  try {
    return jwt.verify(token, SESSION_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Refresh access token for a service
 */
async function refreshServiceToken(chatId: number, service: DestinationService): Promise<string | null> {
  const integration = chatDatabase.findById(chatId);
  const connection = integration ? getConnection(integration, service) : undefined;

  if (!connection?.refreshToken) {
    log("Token refresh failed - no refresh token", { chatId, service });
    return null;
  }

  // Service-specific token refresh
  if (service === DestinationService.SPOTIFY) {
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
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
          grant_type: "refresh_token",
          refresh_token: connection.refreshToken,
        }),
      });

      const data = await res.json();

      if (data.error) {
        log("Token refresh error", { chatId, service, error: data.error });
        return null;
      }

      // Update stored tokens
      connection.accessToken = data.access_token;
      if (data.refresh_token) {
        connection.refreshToken = data.refresh_token;
      }
      setConnection(integration!, connection);
      chatDatabase.update(chatId, integration!);

      log("Token refreshed successfully", { chatId, service });
      return data.access_token;
    } catch (error) {
      log("Token refresh exception", { chatId, service, error: String(error) });
      return null;
    }
  }

  // Other services not yet implemented
  log("Token refresh not implemented for service", { chatId, service });
  return null;
}

/**
 * Generate the Spotify OAuth login link
 */
function getSpotifyAuthLink(): string {
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
  });

  return `https://accounts.spotify.com/authorize?${queryParams}`;
}

// Serve static files
const staticRoot = path.resolve(__dirname, "../public");
app.use(express.static(staticRoot));

if (TELEGRAM_MODE === "webhook") {
  app.use(bot.webhookCallback(WEBHOOK_PATH));
}

/**
 * Health check
 */
app.get("/up", (req: Request, res: Response) => {
  res.send("OK");
});

/**
 * /config - Public configuration for the frontend
 */
app.get("/config", (req: Request, res: Response) => {
  res.json({
    botUsername: config.botUsername,
  });
});

/**
 * /auth/login - Accepts JWT token from bot, sets session, redirects to Spotify
 */
app.get("/auth/login", (req: Request, res: Response) => {
  const token = req.query.token as string;

  if (!token) {
    res.status(400).send(
      "Missing token. Please use the /login command in Telegram to get a login link."
    );
    return;
  }

  const chatAuth = verifyChatAuthToken(token);
  if (!chatAuth) {
    res.status(401).send(
      "Invalid or expired link. Please run /login in Telegram to get a new link."
    );
    return;
  }

  // Create or update the chat integration record
  let integration = chatDatabase.findById(chatAuth.chatId);
  if (!integration) {
    integration = {
      id: chatAuth.chatId,
      chatType: chatAuth.chatType as ChatIntegration["chatType"],
      chatTitle: chatAuth.chatTitle,
      connections: [],
      createdAt: new Date().toISOString(),
    };
    chatDatabase.insert(integration);
  } else {
    // Update chat info if changed
    integration.chatType = chatAuth.chatType as ChatIntegration["chatType"];
    integration.chatTitle = chatAuth.chatTitle;
    chatDatabase.update(chatAuth.chatId, integration);
  }

  // Set session cookie with chat context
  const sessionPayload: SessionPayload = {
    chatId: chatAuth.chatId,
    chatType: chatAuth.chatType,
    chatTitle: chatAuth.chatTitle,
  };
  const sessionToken = createSessionToken(sessionPayload);
  res.cookie("session", sessionToken, {
    httpOnly: true,
    secure: SERVER_PROTOCOL === "https",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  // Redirect to Spotify OAuth
  res.redirect(getSpotifyAuthLink());
});

/**
 * /auth/callback - Exchanges code for tokens, stores by chatId
 */
app.get("/auth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;

  if (!code) {
    res.send("Missing authorization code.");
    return;
  }

  // Get chat context from session
  const session = verifySessionCookie(req);
  if (!session) {
    res.status(401).send(
      "Session expired. Please run /login in Telegram to get a new link."
    );
    return;
  }

  const chatId = session.chatId;
  log("/auth/callback", { code: code.substring(0, 10) + "...", chatId });

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

    // Update chat integration with service tokens
    const integration = chatDatabase.findById(chatId);
    if (integration) {
      const connection: ServiceConnection = {
        service: DestinationService.SPOTIFY, // TODO: make dynamic when adding more services
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      };
      setConnection(integration, connection);
      chatDatabase.update(chatId, integration);
    }

    // Redirect to UI
    res.redirect("/?connected=true");
  } catch (error) {
    console.error("Error exchanging auth code:", error);
    res.send("Error exchanging code for token.");
  }
});

/**
 * /auth/me - Returns current chat info
 */
app.get("/auth/me", (req: Request, res: Response) => {
  const session = verifySessionCookie(req);
  if (!session) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }

  const integration = chatDatabase.findById(session.chatId);
  if (!integration) {
    res.status(401).json({ error: "Chat not found" });
    return;
  }

  // Build services object from connections
  const services: Record<string, { connected: boolean; playlistId?: string; tracksAdded?: number }> = {};
  for (const connection of integration.connections) {
    services[connection.service.toLowerCase()] = {
      connected: !!connection.accessToken,
      playlistId: connection.playlistId,
      tracksAdded: connection.tracksAdded,
    };
  }

  res.json({
    chatId: integration.id,
    chatType: integration.chatType,
    chatTitle: integration.chatTitle,
    smartMatching: integration.smartMatching ?? false,
    services,
  });
});

/**
 * /auth/logout - Clears session cookie
 */
app.post("/auth/logout", (req: Request, res: Response) => {
  res.clearCookie("session");
  res.json({ success: true });
});

/**
 * /playlists - Returns playlists for the chat's connected account
 * TODO: Add service parameter when supporting multiple services
 */
app.get("/playlists", async (req: Request, res: Response) => {
  const session = verifySessionCookie(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const integration = chatDatabase.findById(session.chatId);
  // TODO: Get service from query param when supporting multiple services
  const connection = integration
    ? getConnection(integration, DestinationService.SPOTIFY)
    : undefined;

  if (!connection?.accessToken) {
    res.status(401).json({ error: "Service not connected" });
    return;
  }

  try {
    // TODO: Move to service class when supporting multiple services
    const response = await fetch("https://api.spotify.com/v1/me/playlists", {
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    });
    const data = await response.json();
    if (data.error) {
      res.status(500).json(data.error);
      return;
    }
    res.json(data);
  } catch (err) {
    console.error("Error fetching playlists:", err);
    res.status(500).json({ error: "Error fetching playlists" });
  }
});

/**
 * /create_playlist - Creates a new playlist for the chat's connected account
 * TODO: Add service parameter when supporting multiple services
 */
app.post("/create_playlist", async (req: Request, res: Response) => {
  const session = verifySessionCookie(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const integration = chatDatabase.findById(session.chatId);
  const connection = integration
    ? getConnection(integration, DestinationService.SPOTIFY)
    : undefined;

  if (!connection?.accessToken) {
    res.status(401).json({ error: "Service not connected" });
    return;
  }

  const playlistName = session.chatTitle
    ? `TuneHoard - ${session.chatTitle}`
    : "TuneHoard Playlist";

  try {
    // TODO: Move to service class when supporting multiple services
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    });
    const meData = await meRes.json();

    const createRes = await fetch(
      `https://api.spotify.com/v1/users/${meData.id}/playlists`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.accessToken}`,
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
    res.status(500).json({ error: "Error creating playlist" });
  }
});

/**
 * /set_playlist - Sets the target playlist for the chat
 * TODO: Add service parameter when supporting multiple services
 */
app.post("/set_playlist", async (req: Request, res: Response) => {
  const session = verifySessionCookie(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { playlistId } = req.body;
  if (!playlistId) {
    res.status(400).json({ error: "Missing playlistId in body" });
    return;
  }

  const integration = chatDatabase.findById(session.chatId);
  const connection = integration
    ? getConnection(integration, DestinationService.SPOTIFY)
    : undefined;

  if (!integration || !connection?.accessToken) {
    res.status(404).json({ error: "Chat not found or service not connected" });
    return;
  }

  connection.playlistId = playlistId;
  setConnection(integration, connection);
  chatDatabase.update(session.chatId, integration);

  res.json({ message: "Playlist updated for chat." });
});

/**
 * /settings - Update chat settings
 */
app.post("/settings", async (req: Request, res: Response) => {
  const session = verifySessionCookie(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { smartMatching } = req.body;

  const integration = chatDatabase.findById(session.chatId);
  if (!integration) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }

  if (typeof smartMatching === "boolean") {
    integration.smartMatching = smartMatching;
  }

  chatDatabase.update(session.chatId, integration);

  log("Chat settings updated", {
    chatId: session.chatId,
    smartMatching: integration.smartMatching,
  });

  res.json({ message: "Settings updated.", smartMatching: integration.smartMatching });
});

/**
 * Start the Express server
 */
async function startHttpServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    httpServer = app.listen(SERVER_PORT, () => {
      console.log(
        `Express server listening on port ${SERVER_PORT}, database has ${
          chatDatabase.findAll().length
        } chat integrations`
      );
      resolve();
    });
  });
}

/* --------------------------------------------------
   TELEGRAM BOT COMMANDS
   -------------------------------------------------- */

// Helper function for help message
function getHelpMessage(): string {
  return (
    "Commands:\n" +
    "/login - Connect or manage music service\n" +
    "/status - Show connection status\n" +
    "/disconnect - Remove all connections\n\n" +
    "Just share music links and I'll add them to your playlist!"
  );
}

// Helper to generate auth link
function generateAuthLink(chatId: number, chatType: string, chatTitle?: string): string {
  const token = createChatAuthToken(chatId, chatType, chatTitle);
  return `${BASE_SERVER_URL}/auth/login?token=${token}`;
}

// Welcome message for groups (when bot is added)
function getGroupWelcomeMessage(authUrl: string): string {
  return (
    `Hey! I'm TuneHoard, your friendly music hoarder. ` +
    `Drop any music links in here and I'll save them to a playlist for you.\n\n` +
    `To get started, connect a music service:\n${authUrl}\n\n` +
    `This link expires in 5 minutes. Anyone can run /login to get a new link.`
  );
}

// Welcome message for DMs
function getDMWelcomeMessage(authUrl: string): string {
  return (
    `Hey! I'm TuneHoard, your friendly music hoarder. ` +
    `Send me any music links and I'll save them to a playlist for you.\n\n` +
    `Let's get started - connect your music service:\n${authUrl}\n\n` +
    `This link expires in 5 minutes.`
  );
}

// When bot is added to a group, send welcome message
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.myChatMember;

  // Only handle when bot status changes to member/admin (bot was added)
  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;

  const wasNotMember = oldStatus === "left" || oldStatus === "kicked";
  const isNowMember = newStatus === "member" || newStatus === "administrator";

  if (wasNotMember && isNowMember) {
    const chat = update.chat;
    if (chat.type === "group" || chat.type === "supergroup") {
      const chatTitle = "title" in chat ? chat.title : undefined;
      const authUrl = generateAuthLink(chat.id, chat.type, chatTitle);
      await ctx.reply(getGroupWelcomeMessage(authUrl));
    }
  }
});

// /start - In DM: welcome + auth link. In group: show help
bot.command("start", async (ctx: Context) => {
  if (!ctx.chat) return;

  const chatType = ctx.chat.type;

  if (chatType === "private") {
    const chatTitle = ctx.from?.first_name || ctx.from?.username;
    const authUrl = generateAuthLink(ctx.chat.id, chatType, chatTitle);
    await ctx.reply(getDMWelcomeMessage(authUrl));
  } else {
    // In groups, /start just shows help (they got welcome when bot was added)
    await ctx.reply(getHelpMessage());
  }
});

// /help - Show commands
bot.command("help", async (ctx: Context) => {
  await ctx.reply(getHelpMessage());
});

// /login - Get auth link to connect or manage music service
bot.command("login", async (ctx: Context) => {
  if (!ctx.chat) return;

  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const chatTitle =
    ctx.chat.type === "private"
      ? ctx.from?.first_name || ctx.from?.username
      : "title" in ctx.chat
        ? ctx.chat.title
        : undefined;

  const authUrl = generateAuthLink(chatId, chatType, chatTitle);

  const isGroup = chatType === "group" || chatType === "supergroup";

  if (isGroup) {
    await ctx.reply(
      `Manage music service for this group:\n${authUrl}\n\n` +
      `This link expires in 5 minutes.`
    );
  } else {
    await ctx.reply(
      `Manage your music service:\n${authUrl}\n\n` +
      `This link expires in 5 minutes.`
    );
  }
});

// /status - Show integration status for current chat
bot.command("status", async (ctx: Context) => {
  if (!ctx.chat) return;

  const chatId = ctx.chat.id;
  const integration = chatDatabase.findById(chatId);

  if (!integration || integration.connections.length === 0) {
    await ctx.reply(
      "No services connected for this chat. Use /login to connect."
    );
    return;
  }

  let statusMessage = "";
  let totalTracks = 0;

  for (const connection of integration.connections) {
    const serviceName = connection.service.charAt(0).toUpperCase() + connection.service.slice(1).toLowerCase();
    const tracksAdded = connection.tracksAdded ?? 0;
    totalTracks += tracksAdded;

    if (!connection.accessToken) {
      statusMessage += `${serviceName}: Needs re-authentication\n`;
    } else {
      statusMessage += `${serviceName}: Connected\n`;
      if (connection.playlistId) {
        statusMessage += `  Playlist: Set\n`;
      } else {
        statusMessage += `  Playlist: Not set - run /login to select one\n`;
      }
    }
  }

  statusMessage += `\nTracks saved: ${totalTracks}`;
  statusMessage += `\nSmart Matching: ${integration.smartMatching ? "On" : "Off"}`;

  await ctx.reply(statusMessage);
});

// /disconnect - Delete by chatId
bot.command("disconnect", async (ctx: Context) => {
  if (!ctx.chat) return;

  const deleted = chatDatabase.delete(ctx.chat.id);
  if (deleted) {
    await ctx.reply("All service connections removed for this chat.");
  } else {
    await ctx.reply("No connections found for this chat.");
  }
});

// Respond to @mentions of the bot (at start of message)
bot.on(message("text"), async (ctx, next) => {
  const text = ctx.message.text;
  const botUsername = ctx.botInfo.username;

  // Check if message starts with @botname
  if (text.startsWith(`@${botUsername}`)) {
    await ctx.reply(getHelpMessage());
    return;
  }

  // Continue to next handler
  return next();
});

// On any text message, look for music links
bot.on(message("text"), async (ctx) => {
  if (!ctx.chat) return;
  const text = ctx.message.text;

  log("Incoming message", { text, chatId: ctx.chat.id });

  // Find which service can handle this URL
  const resolvedService = MusicService.resolve(text);
  if (!resolvedService) {
    log("No music service matched", { text });
    return;
  }

  log("Service matched", { service: resolvedService.name, text });

  const sourceService = resolvedService.service;

  // Extract track data from the URL
  const extractedData = await sourceService.extractTrackData(text);
  if (!extractedData) {
    log("Failed to extract track data", {
      text,
      service: resolvedService.name,
    });
    if (IS_DEV) {
      await ctx.reply(`[DEV] Couldn't extract track data from this link`);
    }
    return;
  }

  log("Track data extracted", {
    title: extractedData.title,
    hasDescription: !!extractedData.description,
  });

  // Normalize the extracted data
  const parsedData = TrackTitleNormalizer.normalize(
    extractedData.title,
    extractedData.description
  );

  log("Track data normalized", {
    rawTitle: parsedData.rawTitle,
    artist: parsedData.artist,
    song: parsedData.song,
  });

  // Get the chat's integration
  const chatId = ctx.chat.id;
  const integration = chatDatabase.findById(chatId);

  if (!integration) {
    log("No integration for chat", { chatId });
    return;
  }

  // Find connections that are ready to receive tracks (have token and playlist)
  const readyConnections = integration.connections.filter(
    (c) => c.accessToken && c.playlistId
  );

  if (readyConnections.length === 0) {
    log("No configured connections for adding tracks", { chatId });
    return;
  }

  const useSmartMatching = integration.smartMatching ?? false;

  // Process each ready connection
  for (const connection of readyConnections) {
    const destinationService = MusicService.get(connection.service);
    if (!destinationService) {
      log("Destination service not found", { service: connection.service });
      continue;
    }

    const getToken = (): string | null => {
      return connection.accessToken ?? null;
    };

    const refreshToken = async (): Promise<string | null> => {
      return await refreshServiceToken(chatId, connection.service);
    };

    // Use TrackMatcher to find a match
    const match = await trackMatcher.match(parsedData, [destinationService], getToken, {
      useSmartMatching,
      refreshToken,
    });

    if (!match) {
      log("Failed to match track", { text, service: connection.service });
      if (IS_DEV) {
        await ctx.reply(`[DEV] Couldn't find "${parsedData.rawTitle}" on ${connection.service}`);
      }
      continue;
    }

    log("Track matched", {
      service: connection.service,
      artist: match.trackInfo.artist,
      song: match.trackInfo.song,
      confidence: match.confidence,
      uri: match.uri,
    });

    // Add track to the playlist
    log("Adding track to playlist", {
      chatId,
      service: connection.service,
      playlistId: connection.playlistId,
      artist: match.trackInfo.artist,
      song: match.trackInfo.song,
    });

    let result = await destinationService.addTrack(
      match.uri,
      connection.playlistId!,
      connection.accessToken!
    );

    // If token expired, try to refresh and retry once
    if (result.needsReauth) {
      log("Token expired, attempting refresh", { chatId, service: connection.service });
      const newToken = await refreshServiceToken(chatId, connection.service);

      if (newToken) {
        result = await destinationService.addTrack(
          match.uri,
          connection.playlistId!,
          newToken
        );
      }
    }

    if (result.success) {
      // Increment tracks added counter
      connection.tracksAdded = (connection.tracksAdded ?? 0) + 1;
      setConnection(integration, connection);
      chatDatabase.update(chatId, integration);

      log("Track added successfully", {
        chatId,
        service: connection.service,
        playlistId: connection.playlistId,
        totalTracks: connection.tracksAdded,
      });

      if (IS_DEV) {
        await ctx.reply(
          `[DEV] Added "${match.trackInfo.artist} - ${match.trackInfo.song}" to ${connection.service}`
        );
      }
    } else {
      log("Track add failed", {
        chatId,
        service: connection.service,
        playlistId: connection.playlistId,
        error: result.error,
      });

      if (IS_DEV) {
        await ctx.reply(
          `[DEV] Failed to add "${match.trackInfo.artist} - ${match.trackInfo.song}" to ${connection.service}: ${result.error}`
        );
      }
    }
  }
});

// Bot errors
bot.catch((err) => {
  console.error("Telegram bot error:", err);
});

async function startBot(): Promise<void> {
  // Register commands with Telegram so they show in the "/" menu
  await bot.telegram.setMyCommands([
    { command: "login", description: "Connect or manage music service" },
    { command: "status", description: "Show connection status" },
    { command: "disconnect", description: "Remove all connections" },
    { command: "help", description: "Show commands" },
  ]);

  if (TELEGRAM_MODE === "webhook") {
    const webhookUrl = `${BASE_SERVER_URL}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(webhookUrl, {
      drop_pending_updates: true,
    });
    console.log(`Telegram bot listening via webhook at ${webhookUrl}`);
    return;
  }

  await bot.telegram.deleteWebhook({
    drop_pending_updates: true,
  });

  await bot.launch({
    dropPendingUpdates: true,
  });
  console.log("Telegram bot started via long polling...");
}

async function bootstrap() {
  try {
    await startHttpServer();
    await startBot();
  } catch (error) {
    console.error("Failed to bootstrap application:", error);
    process.exit(1);
  }
}

bootstrap();

// Graceful stop
function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  httpServer?.close();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
