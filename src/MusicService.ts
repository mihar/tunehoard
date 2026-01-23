import { TrackTitleNormalizer } from "./TrackTitleNormalizer";
import { log } from "./logger";

export type TrackInfo = {
  artist: string;
  song: string;
};

// Raw data extracted from source URL
export type ExtractedData = {
  title: string;
  description?: string;
};

// What flows through the pipeline (parsing enriches this)
export type ParsedTrackData = {
  rawTitle: string;
  rawDescription?: string;
  artist?: string;  // Populated if we could parse it
  song?: string;    // Populated if we could parse it
};

// What search returns
export type SearchMatch = {
  trackInfo: TrackInfo;  // Normalized { artist, song }
  confidence: number;    // 0-1
  uri: string;           // Service-specific ID for adding
  service: string;       // Which service found this
};

// Search result that may indicate auth failure
export type SearchResult = {
  match: SearchMatch | null;
  needsReauth?: boolean;
};

// Result of adding a track
export type AddTrackResult = {
  success: boolean;
  error?: string;
  needsReauth?: boolean;
};

export enum DestinationService {
  SPOTIFY = "spotify",
  // YOUTUBE = "youtube",
}

type MusicServiceFactory<T extends MusicService = MusicService> = () => T;

type MusicServiceRegistration<T extends MusicService = MusicService> = {
  create: MusicServiceFactory<T>;
  matchUrl?: (str: string) => boolean;
};

export type MusicServiceOptions = {
  apiKey: string;
};

export abstract class MusicService {
  public name: string;
  public accessToken?: string;
  protected readonly options: MusicServiceOptions;

  protected constructor(options: MusicServiceOptions) {
    this.options = options;
  }

  // -- Static interface

  private static readonly services: Map<string, MusicServiceRegistration> =
    new Map();

  public static register<T extends MusicService>(
    name: string,
    registration: MusicServiceRegistration<T>
  ): void {
    MusicService.services.set(name, registration);
  }

  public static unregister(name: string): void {
    MusicService.services.delete(name);
  }

  public static get(name: DestinationService): MusicService | undefined {
    const registration = MusicService.services.get(name);
    return registration?.create();
  }

  public static list(): string[] {
    return Array.from(MusicService.services.keys());
  }

  public static resolve(url: string): {
    name: string;
    service: MusicService;
  } | null {
    let match: {
      name: string;
      service: MusicService;
    } | null = null;

    MusicService.services.forEach((registration, name) => {
      if (match) {
        return;
      }

      if (registration.matchUrl?.(url)) {
        match = { name, service: registration.create() };
      }
    });

    return match;
  }

  // -- Instance interface (legacy - kept for backward compatibility)
  public abstract getTrack(str: string): Promise<TrackInfo | null>;
  public abstract addToPlaylist(options: {
    playlistId: string;
    trackInfo: TrackInfo;
    accessToken: string;
  }): Promise<{ success: boolean; error?: string; needsReauth?: boolean }>;

  // -- New unified interface

  // Source: Can this service handle this URL?
  public abstract matchUrl(url: string): boolean;

  // Source: Extract raw data from a URL
  public abstract extractTrackData(url: string): Promise<ExtractedData | null>;

  // Matching: Search for a track, return with confidence
  public abstract searchTrack(data: ParsedTrackData, accessToken: string): Promise<SearchResult>;

  // Destination: Add a track to a playlist by URI
  public abstract addTrack(uri: string, playlistId: string, accessToken: string): Promise<AddTrackResult>;
}

export class YoutubeService extends MusicService {
  public name = "youtube";
  private readonly apiKey: string;

  constructor(options: MusicServiceOptions) {
    super(options);
    this.apiKey = options.apiKey;
  }

  public static matchUrl(str: string) {
    return (
      str.includes("youtube.com") ||
      str.includes("youtu.be") ||
      str.includes("music.youtube.com")
    );
  }

  // -- New unified interface

  public matchUrl(url: string): boolean {
    return YoutubeService.matchUrl(url);
  }

  public async extractTrackData(url: string): Promise<ExtractedData | null> {
    const videoId = this.getVideoId(url);
    if (!videoId) {
      log("YouTube: No video ID extracted", { url });
      return null;
    }

    log("YouTube: Video ID extracted", { videoId, url });

    const metadata = await this.fetchMetadata(videoId);
    if (!metadata) {
      log("YouTube: Failed to fetch metadata", { videoId });
      return null;
    }

    log("YouTube: Metadata fetched", { videoId, title: metadata.title });

    return {
      title: metadata.title,
      description: metadata.description,
    };
  }

  public async searchTrack(data: ParsedTrackData, accessToken: string): Promise<SearchResult> {
    // YouTube search is not implemented yet - would require YouTube Music API
    // For now, return null to let other services handle the search
    log("YouTube: searchTrack not implemented");
    return { match: null };
  }

  public async addTrack(uri: string, playlistId: string, accessToken: string): Promise<AddTrackResult> {
    // YouTube playlist add is not implemented yet
    return { success: false, error: "YouTube playlist add not implemented" };
  }

  // -- Legacy interface

  public async getTrack(str: string): Promise<TrackInfo | null> {
    const videoId = this.getVideoId(str);
    if (!videoId) {
      log("No video ID extracted", { url: str });
      return null;
    }

    log("Video ID extracted", { videoId, url: str });

    const title = await this.fetchTitle(videoId);
    log("YouTube title fetched", { videoId, title });

    const result = TrackTitleNormalizer.parse(title);
    log(result ? "Title parsed successfully" : "Title parsing failed", {
      title,
      result
    });

    return result;
  }

  public async addToPlaylist(options: {
    playlistId: string;
    trackInfo: TrackInfo;
    accessToken: string;
  }): Promise<{ success: boolean; error?: string; needsReauth?: boolean }> {
    throw new Error("Not implemented");
  }

  // -- Helper methods

  public getVideoId(str: string) {
    const regex =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = str.match(regex);
    return match ? match[1] : null;
  }

  public async fetchTitle(videoId: string) {
    const metadata = await this.fetchMetadata(videoId);
    return metadata?.title ?? "Unknown Title";
  }

  public async fetchMetadata(videoId: string): Promise<{ title: string; description: string } | null> {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.apiKey}&part=snippet`
    );
    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      return null;
    }
    return {
      title: data.items[0].snippet.title,
      description: data.items[0].snippet.description,
    };
  }
}

export class SpotifyService extends MusicService {
  public name = "spotify";

  constructor(options: MusicServiceOptions) {
    super(options);
  }

  // -- New unified interface

  public matchUrl(url: string): boolean {
    return url.includes("open.spotify.com") || url.includes("spotify:");
  }

  public async extractTrackData(url: string): Promise<ExtractedData | null> {
    // Extract track ID from Spotify URL
    // Formats: https://open.spotify.com/track/ID or spotify:track:ID
    const trackIdMatch = url.match(/track[/:]([a-zA-Z0-9]+)/);
    if (!trackIdMatch) {
      log("Spotify: Could not extract track ID from URL", { url });
      return null;
    }

    const trackId = trackIdMatch[1];
    log("Spotify: Track ID extracted", { trackId, url });

    // For now, just return the URL as title - we'd need an API call to get actual metadata
    // This is a placeholder that can be enhanced later
    return {
      title: `spotify:track:${trackId}`,
    };
  }

  public async searchTrack(data: ParsedTrackData, accessToken: string): Promise<SearchResult> {
    // If we have both artist and song, use structured search
    if (data.artist && data.song) {
      const searchResult = await this.search({
        trackInfo: { artist: data.artist, song: data.song },
        accessToken,
      });

      if (searchResult.needsReauth) {
        log("Spotify searchTrack: needs reauth");
        return { match: null, needsReauth: true };
      }

      if (searchResult.uri) {
        return {
          match: {
            trackInfo: { artist: data.artist, song: data.song },
            confidence: 0.9, // High confidence when we have structured data
            uri: searchResult.uri,
            service: this.name,
          },
        };
      }
    }

    // Fall back to title search with fuzzy matching
    // Pass description too - it may contain artist info that helps matching
    const titleResult = await this.searchByTitle({
      title: data.rawTitle,
      description: data.rawDescription,
      accessToken,
    });

    if (titleResult.needsReauth) {
      log("Spotify searchTrack title fallback: needs reauth");
      return { match: null, needsReauth: true };
    }

    if (titleResult.trackInfo && titleResult.uri) {
      return {
        match: {
          trackInfo: titleResult.trackInfo,
          confidence: titleResult.confidence ?? 0.6,
          uri: titleResult.uri,
          service: this.name,
        },
      };
    }

    return { match: null };
  }

  public async addTrack(uri: string, playlistId: string, accessToken: string): Promise<AddTrackResult> {
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ uris: [uri] }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        log("Spotify addTrack failed", { status: res.status, error: data.error });
        if (res.status === 401) {
          return { success: false, error: "Access token expired", needsReauth: true };
        }
        return { success: false, error: data.error?.message || `HTTP ${res.status}` };
      }

      return { success: true };
    } catch (error) {
      log("Spotify addTrack error", { error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  // -- Legacy interface

  public async getTrack(str: string): Promise<TrackInfo | null> {
    throw new Error("Not implemented");
  }

  public async search(options: { trackInfo: TrackInfo; accessToken?: string }): Promise<{ uri: string | null; needsReauth?: boolean }> {
    const { trackInfo, accessToken } = options;
    const token = accessToken || this.accessToken;

    // Try multiple search strategies in order of specificity
    const strategies = [
      // Strategy 1: Field filters (most precise)
      `artist:${trackInfo.artist} track:${trackInfo.song}`,
      // Strategy 2: Simple combined search (like Spotify app)
      `${trackInfo.artist} ${trackInfo.song}`,
      // Strategy 3: Just the song name (if artist match is problematic)
      trackInfo.song,
    ];

    for (const rawQuery of strategies) {
      const query = encodeURIComponent(rawQuery);
      log("Spotify search attempt", { strategy: rawQuery, artist: trackInfo.artist, song: trackInfo.song });

      try {
        const res = await fetch(
          `https://api.spotify.com/v1/search?q=${query}&type=track&limit=5`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        const data = await res.json();

        if (data.error) {
          log("Spotify search error response", { query: rawQuery, error: data.error });
          // If auth error, don't try other strategies - they'll fail too
          if (data.error.status === 401) {
            return { uri: null, needsReauth: true };
          }
          continue;
        }

        if (data.tracks?.items?.length > 0) {
          // First strategy uses field filters - trust Spotify's matching
          // For broader strategies, verify the result is a reasonable match
          const isFieldFilterStrategy = rawQuery.includes('artist:') && rawQuery.includes('track:');
          const track = isFieldFilterStrategy
            ? data.tracks.items[0]
            : this.findBestMatch(data.tracks.items, trackInfo);

          if (track) {
            log("Spotify search found", {
              strategy: rawQuery,
              uri: track.uri,
              name: track.name,
              artist: track.artists?.[0]?.name
            });
            return { uri: track.uri };
          }
          log("Spotify search results didn't match", { strategy: rawQuery, results: data.tracks.items.length });
        } else {
          log("Spotify search no results", { strategy: rawQuery });
        }
      } catch (error) {
        log("Spotify search error", { strategy: rawQuery, error: String(error) });
      }
    }

    log("Spotify search exhausted all strategies", { artist: trackInfo.artist, song: trackInfo.song });
    return { uri: null };
  }

  private findBestMatch(tracks: any[], trackInfo: TrackInfo): any | null {
    const targetArtist = this.normalizeForComparison(trackInfo.artist);
    const targetSong = this.normalizeForComparison(trackInfo.song);

    for (const track of tracks) {
      const trackName = this.normalizeForComparison(track.name || '');
      const artistNames = (track.artists || [])
        .map((a: any) => this.normalizeForComparison(a.name || ''))
        .join(' ');

      // Check if song name matches (or contains) and artist matches (or contains)
      const songMatches = trackName.includes(targetSong) || targetSong.includes(trackName);
      const artistMatches = artistNames.includes(targetArtist) || targetArtist.includes(artistNames);

      if (songMatches && artistMatches) {
        return track;
      }
    }

    // If no good match, return the first result for the most specific strategy only
    // For broader strategies, return null to try the next strategy
    return null;
  }

  /**
   * Search Spotify with a raw title string (no artist/song structure needed).
   * Uses fuzzy matching to validate results against the query.
   * Optionally uses description to boost confidence when artist/track info is found there.
   */
  public async searchByTitle(options: {
    title: string;
    description?: string;
    accessToken?: string;
  }): Promise<{ trackInfo: TrackInfo | null; uri?: string; confidence?: number; needsReauth?: boolean }> {
    const { title, description, accessToken } = options;
    const token = accessToken || this.accessToken;

    const query = encodeURIComponent(title);
    log("Spotify title search", { title, hasDescription: !!description });

    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${query}&type=track&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = await res.json();

      if (data.error) {
        log("Spotify title search error", { title, error: data.error });
        if (data.error.status === 401) {
          return { trackInfo: null, needsReauth: true };
        }
        return { trackInfo: null };
      }

      if (!data.tracks?.items?.length) {
        log("Spotify title search no results", { title });
        return { trackInfo: null };
      }

      // Find the best matching track using fuzzy matching
      // Pass description to help with confidence calculation
      const match = this.findBestTitleMatch(data.tracks.items, title, description);
      if (match) {
        log("Spotify title search found", {
          title,
          matchedTrack: match.track.name,
          matchedArtist: match.track.artists?.[0]?.name,
          similarity: match.similarity,
          descriptionBoost: match.descriptionBoost,
        });
        return {
          trackInfo: {
            artist: match.track.artists?.[0]?.name || 'Unknown Artist',
            song: match.track.name,
          },
          uri: match.track.uri,
          confidence: match.similarity,
        };
      }

      log("Spotify title search no confident match", { title, results: data.tracks.items.length });
      return { trackInfo: null };
    } catch (error) {
      log("Spotify title search error", { title, error: String(error) });
      return { trackInfo: null };
    }
  }

  /**
   * Find the best matching track from Spotify results for a given title.
   * Uses word overlap similarity to determine match quality.
   * If description is provided, checks if artist/track names appear there for confidence boost.
   */
  private findBestTitleMatch(
    tracks: any[],
    title: string,
    description?: string
  ): { track: any; similarity: number; descriptionBoost: boolean } | null {
    const normalizedTitle = this.normalizeForComparison(title);
    const titleWords = this.getWords(normalizedTitle);

    // Normalize description for matching (take first 2000 chars to avoid huge descriptions)
    const normalizedDescription = description
      ? this.normalizeForComparison(description.slice(0, 2000))
      : '';

    let bestMatch: { track: any; similarity: number; descriptionBoost: boolean } | null = null;

    for (const track of tracks) {
      const trackName = this.normalizeForComparison(track.name || '');
      const artistName = this.normalizeForComparison(
        (track.artists || []).map((a: any) => a.name).join(' ')
      );

      // Combine track name and artist for comparison
      const combinedWords = this.getWords(`${trackName} ${artistName}`);

      // Calculate word overlap similarity
      const similarity = this.calculateWordOverlap(titleWords, combinedWords);

      // Also check if the title contains the track name or vice versa
      const titleContainsTrack = normalizedTitle.includes(trackName);
      const trackContainsTitle = trackName.includes(normalizedTitle);

      // Check if artist or track name appears in description
      // This helps when title is just "Crossing Muddy Waters" but description has "John Hiatt"
      const artistInDescription = normalizedDescription && artistName.length > 3
        ? normalizedDescription.includes(artistName)
        : false;
      const trackInDescription = normalizedDescription && trackName.length > 3
        ? normalizedDescription.includes(trackName)
        : false;
      const descriptionBoost = artistInDescription; // Only artist match counts as boost

      // Calculate adjusted similarity
      let adjustedSimilarity = similarity;

      // Boost if title contains track or vice versa
      if (titleContainsTrack || trackContainsTitle) {
        adjustedSimilarity = Math.max(adjustedSimilarity, 0.7);
      }

      // Artist in description is strong confirmation - this helps pick the right
      // version when there are multiple covers of the same song
      if (artistInDescription) {
        // Add a significant boost that will beat tracks without artist match
        adjustedSimilarity += 0.1;
        log("Spotify match: artist found in description", {
          artist: artistName,
          track: trackName,
        });
      }
      // Track name in description alone doesn't help distinguish between covers
      // so we don't boost for that

      log("Spotify match candidate", {
        track: track.name,
        artist: track.artists?.[0]?.name,
        similarity: adjustedSimilarity,
        descriptionBoost,
      });

      if (adjustedSimilarity > (bestMatch?.similarity ?? 0)) {
        bestMatch = { track, similarity: adjustedSimilarity, descriptionBoost };
      }
    }

    // Require at least 50% similarity to consider it a match
    if (bestMatch && bestMatch.similarity >= 0.5) {
      return bestMatch;
    }

    return null;
  }

  private normalizeForComparison(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  }

  private getWords(s: string): Set<string> {
    return new Set(s.split(/\s+/).filter(w => w.length > 0));
  }

  private calculateWordOverlap(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 || set2.size === 0) return 0;

    let matches = 0;
    for (const word of set1) {
      if (set2.has(word)) {
        matches++;
      }
    }

    // Use Jaccard-like similarity but weighted toward the query
    return matches / set1.size;
  }

  public async addToPlaylist(options: {
    playlistId: string;
    trackInfo: TrackInfo;
    accessToken: string;
  }): Promise<{ success: boolean; error?: string; needsReauth?: boolean }> {
    const searchResult = await this.search({
      trackInfo: options.trackInfo,
      accessToken: options.accessToken,
    });

    if (searchResult.needsReauth) {
      return { success: false, error: "Access token expired", needsReauth: true };
    }

    if (!searchResult.uri) {
      return { success: false, error: "Track not found on Spotify" };
    }

    try {
      const res = await fetch(
        `https://api.spotify.com/v1/playlists/${options.playlistId}/tracks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.accessToken}`,
          },
          body: JSON.stringify({ uris: [searchResult.uri] }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        log("Spotify add to playlist failed", { status: res.status, error: data.error });
        if (res.status === 401) {
          return { success: false, error: "Access token expired", needsReauth: true };
        }
        return { success: false, error: data.error?.message || `HTTP ${res.status}` };
      }

      return { success: true };
    } catch (error) {
      log("Spotify add to playlist error", { error: String(error) });
      return { success: false, error: String(error) };
    }
  }
}
