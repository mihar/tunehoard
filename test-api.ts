/**
 * Manual API integration test script.
 * Run with: npx ts-node test-api.ts
 *
 * Tests the full pipeline with real API calls:
 * - YouTube metadata extraction
 * - Spotify search (structured and raw title)
 * - Full TrackMatcher pipeline
 */

import "dotenv/config";
import { YoutubeService, SpotifyService, MusicService, DestinationService } from "./src/MusicService";
import { TrackTitleNormalizer } from "./src/TrackTitleNormalizer";
import { trackMatcher } from "./src/TrackMatcher";
import { config } from "./src/config";

async function testYouTubeExtraction() {
  console.log("\n=== Testing YouTube Extraction ===");

  const youtube = new YoutubeService({ apiKey: config.youtubeApiKey });

  // Test URLs with different formats
  const testUrls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // Rick Astley - Never Gonna Give You Up
    "https://youtu.be/fJ9rUzIMcZQ", // Queen - Bohemian Rhapsody
  ];

  for (const url of testUrls) {
    console.log(`\nTesting: ${url}`);

    // Test matchUrl
    const matches = youtube.matchUrl(url);
    console.log(`  matchUrl: ${matches}`);

    if (matches) {
      // Test extractTrackData
      const extracted = await youtube.extractTrackData(url);
      console.log(`  extractTrackData:`, extracted);

      if (extracted) {
        // Test normalize
        const parsed = TrackTitleNormalizer.normalize(extracted.title, extracted.description);
        console.log(`  normalized:`, {
          rawTitle: parsed.rawTitle,
          artist: parsed.artist,
          song: parsed.song,
        });
      }
    }
  }
}

async function testSpotifySearch(accessToken: string) {
  console.log("\n=== Testing Spotify Search ===");

  const spotify = new SpotifyService({ apiKey: "" });

  // Test with structured data (artist + song)
  console.log("\nTest 1: Structured search (artist + song)");
  const structuredData = {
    rawTitle: "Rick Astley - Never Gonna Give You Up",
    artist: "Rick Astley",
    song: "Never Gonna Give You Up",
  };

  const result1 = await spotify.searchTrack(structuredData, accessToken);
  console.log("  Result:", result1.match ? {
    artist: result1.match.trackInfo.artist,
    song: result1.match.trackInfo.song,
    confidence: result1.match.confidence,
    uri: result1.match.uri,
  } : null);

  // Test with just raw title (no artist/song parsed)
  console.log("\nTest 2: Raw title search (no artist/song)");
  const rawData = {
    rawTitle: "Crossing Muddy Waters",
  };

  const result2 = await spotify.searchTrack(rawData, accessToken);
  console.log("  Result:", result2.match ? {
    artist: result2.match.trackInfo.artist,
    song: result2.match.trackInfo.song,
    confidence: result2.match.confidence,
    uri: result2.match.uri,
  } : null);

  // Test with a more obscure title
  console.log("\nTest 3: Obscure title search");
  const obscureData = {
    rawTitle: "Sunglasses At Night Corey Hart",
  };

  const result3 = await spotify.searchTrack(obscureData, accessToken);
  console.log("  Result:", result3.match ? {
    artist: result3.match.trackInfo.artist,
    song: result3.match.trackInfo.song,
    confidence: result3.match.confidence,
    uri: result3.match.uri,
  } : null);
}

async function testFullPipeline(accessToken: string) {
  console.log("\n=== Testing Full Pipeline ===");

  const youtube = new YoutubeService({ apiKey: config.youtubeApiKey });
  const spotify = new SpotifyService({ apiKey: "" });

  // Register services for resolve
  MusicService.register("youtube", {
    matchUrl: YoutubeService.matchUrl,
    create: () => youtube,
  });

  // Test 1: Standard "Artist - Song" format
  const testUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  console.log(`\nTest 1 - Standard format: ${testUrl}`);

  // Step 1: Resolve
  const resolved = MusicService.resolve(testUrl);
  console.log("1. Resolved service:", resolved?.name);

  if (!resolved) {
    console.log("  FAILED: Could not resolve URL");
    return;
  }

  // Step 2: Extract
  const extracted = await resolved.service.extractTrackData(testUrl);
  console.log("2. Extracted data:", extracted?.title);

  if (!extracted) {
    console.log("  FAILED: Could not extract data");
    return;
  }

  // Step 3: Normalize
  const parsed = TrackTitleNormalizer.normalize(extracted.title, extracted.description);
  console.log("3. Parsed data:", { artist: parsed.artist, song: parsed.song, rawTitle: parsed.rawTitle });

  // Step 4: Match
  const match = await trackMatcher.match(
    parsed,
    [spotify],
    (service) => accessToken,
    { useSmartMatching: false }
  );

  console.log("4. Match result:", match ? {
    artist: match.trackInfo.artist,
    song: match.trackInfo.song,
    confidence: match.confidence,
    uri: match.uri,
  } : null);

  if (match) {
    console.log("\n✅ Test 1 SUCCESS!");
  } else {
    console.log("\n❌ Test 1 FAILED to find match");
  }

  // Test 2: Title-only with artist in description (Crossing Muddy Waters)
  const testUrl2 = "https://youtu.be/DGk7xv6Xp5A?si=quoieCz4rqnsLCAU";
  console.log(`\n\nTest 2 - Title only with artist in description: ${testUrl2}`);

  const resolved2 = MusicService.resolve(testUrl2);
  console.log("1. Resolved service:", resolved2?.name);

  if (!resolved2) {
    console.log("  FAILED: Could not resolve URL");
    return;
  }

  const extracted2 = await resolved2.service.extractTrackData(testUrl2);
  console.log("2. Extracted data:", extracted2?.title);
  console.log("   Description preview:", extracted2?.description?.slice(0, 200) + "...");

  if (!extracted2) {
    console.log("  FAILED: Could not extract data");
    return;
  }

  const parsed2 = TrackTitleNormalizer.normalize(extracted2.title, extracted2.description);
  console.log("3. Parsed data:", { artist: parsed2.artist, song: parsed2.song, rawTitle: parsed2.rawTitle });

  const match2 = await trackMatcher.match(
    parsed2,
    [spotify],
    (service) => accessToken,
    { useSmartMatching: false }
  );

  console.log("4. Match result:", match2 ? {
    artist: match2.trackInfo.artist,
    song: match2.trackInfo.song,
    confidence: match2.confidence,
    uri: match2.uri,
  } : null);

  if (match2) {
    console.log("\n✅ Test 2 SUCCESS! (Title-only search with description boost)");
  } else {
    console.log("\n❌ Test 2 FAILED to find match");
  }

  // Test 3: Another title-only case
  const testUrl3 = "https://youtu.be/EQrQ3wPN5eA?si=CHHUt6V1MjcTknFp";
  console.log(`\n\nTest 3 - Another video: ${testUrl3}`);

  const resolved3 = MusicService.resolve(testUrl3);
  console.log("1. Resolved service:", resolved3?.name);

  if (!resolved3) {
    console.log("  FAILED: Could not resolve URL");
    return;
  }

  const extracted3 = await resolved3.service.extractTrackData(testUrl3);
  console.log("2. Extracted data:", extracted3?.title);
  console.log("   Description preview:", extracted3?.description?.slice(0, 300) + "...");

  if (!extracted3) {
    console.log("  FAILED: Could not extract data");
    return;
  }

  const parsed3 = TrackTitleNormalizer.normalize(extracted3.title, extracted3.description);
  console.log("3. Parsed data:", { artist: parsed3.artist, song: parsed3.song, rawTitle: parsed3.rawTitle });

  const match3 = await trackMatcher.match(
    parsed3,
    [spotify],
    (service) => accessToken,
    { useSmartMatching: false }
  );

  console.log("4. Match result:", match3 ? {
    artist: match3.trackInfo.artist,
    song: match3.trackInfo.song,
    confidence: match3.confidence,
    uri: match3.uri,
  } : null);

  if (match3) {
    console.log("\n✅ Test 3 SUCCESS!");
  } else {
    console.log("\n❌ Test 3 FAILED to find match");
  }
}

async function getSpotifyClientToken(): Promise<string | null> {
  const clientId = config.spotify.clientId;
  const clientSecret = config.spotify.clientSecret;

  if (!clientId || !clientSecret) {
    console.log("Spotify credentials not configured");
    return null;
  }

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
      body: "grant_type=client_credentials",
    });

    const data = await response.json();
    if (data.error) {
      console.log("Failed to get Spotify token:", data.error);
      return null;
    }

    return data.access_token;
  } catch (error) {
    console.log("Error getting Spotify token:", error);
    return null;
  }
}

async function main() {
  console.log("API Integration Test");
  console.log("====================");

  // Check for required config
  if (!config.youtubeApiKey) {
    console.error("ERROR: YOUTUBE_API_KEY not set");
    process.exit(1);
  }

  console.log("YouTube API Key: " + config.youtubeApiKey.slice(0, 10) + "...");

  // Test YouTube extraction
  await testYouTubeExtraction();

  // Get Spotify token using client credentials
  console.log("\nGetting Spotify client credentials token...");
  const spotifyToken = await getSpotifyClientToken();

  if (spotifyToken) {
    console.log("Spotify token obtained: " + spotifyToken.slice(0, 20) + "...");
    await testSpotifySearch(spotifyToken);
    await testFullPipeline(spotifyToken);
  } else {
    console.log("\n⚠️  Skipping Spotify tests - could not get token");
  }
}

main().catch(console.error);
