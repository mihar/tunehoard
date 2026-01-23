# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TuneHoard (audiobot) is a Telegram bot that lets users connect their Spotify accounts and automatically add music tracks to playlists. Users share YouTube or Spotify links in Telegram, and the bot parses the track info and adds it to their connected Spotify playlist.

## Commands

- `npm run dev` - Development mode with hot reload (ts-node + nodemon)
- `npm run build` - Compile TypeScript to dist/
- `npm start` - Build and run production server
- `npm test` - Run tests with Node.js native test framework

## Architecture

### Entry Points
- `src/index.ts` - Main application: Express server + Telegraf bot setup, routes, and message handling
- `public/index.html` - React-based UI for Spotify playlist picker (CDN-loaded React, no build step)

### Core Components

**Database.ts** - Generic file-based persistence using JSONL format. Stores one JSON object per line in `storage/data.jsonl`. Maintains in-memory lookup map by Telegram user ID.

**MusicService.ts** - Abstract factory pattern for music services with registry system:
- `YoutubeService` - Parses video IDs, fetches titles via YouTube API
- `SpotifyService` - Searches tracks and adds to playlists

**TrackTitleNormalizer.ts** - Regex-based parser that extracts artist/song from video titles. Strips noise like "[Official Video]", normalizes featuring credits.

### Data Flow
1. User sends Telegram message with YouTube/Spotify link
2. Bot identifies service type and extracts track info
3. TrackTitleNormalizer parses "Artist - Song" format from title
4. For each user with a selected playlist, SpotifyService searches and adds the track

### Express Routes
- `GET /up` - Health check
- `GET /auth/login` - Initiates Spotify OAuth
- `GET /auth/callback` - Completes OAuth flow
- `GET /playlists` - Lists user's Spotify playlists
- `POST /create_playlist` - Creates new Spotify playlist
- `POST /set_playlist` - Sets target playlist for user

### Telegram Commands
- `/start` - Welcome message
- `/help` - Command list
- `/login` - Generate Spotify auth link
- `/disconnect` - Remove user data

## Configuration

Environment variables (via .env):
- `BOT_TOKEN` - Telegram bot token
- `YOUTUBE_API_KEY` - YouTube Data API key
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` - Spotify API credentials
- `SERVER_PROTOCOL`, `SERVER_NAME`, `SERVER_PORT` - Server URL config
- `TELEGRAM_MODE` - "webhook" or "polling"

## Deployment

Docker-based deployment via Kamal. GitHub Actions builds and pushes to DigitalOcean Container Registry on master push.
