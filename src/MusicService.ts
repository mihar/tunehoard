import { TrackTitleNormalizer } from "./TrackTitleNormalizer";

export type TrackInfo = {
  artist: string;
  song: string;
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

  // -- Instance interface
  public abstract getTrack(str: string): Promise<TrackInfo | null>;
  public abstract addToPlaylist(options: {
    playlistId: string;
    trackInfo: TrackInfo;
    accessToken: string;
  }): Promise<void>;
}

export class YoutubeService extends MusicService {
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

  public async getTrack(str: string): Promise<TrackInfo | null> {
    const videoId = this.getVideoId(str);
    if (!videoId) {
      return null;
    }
    const title = await this.fetchTitle(videoId);
    return TrackTitleNormalizer.parse(title);
  }

  public getVideoId(str: string) {
    const regex =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = str.match(regex);
    return match ? match[1] : null;
  }

  public async fetchTitle(videoId: string) {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.apiKey}&part=snippet`
    );
    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      return "Unknown Title";
    }
    return data.items[0].snippet.title;
  }

  public async addToPlaylist(options: {
    playlistId: string;
    trackInfo: TrackInfo;
    accessToken: string;
  }): Promise<void> {
    throw new Error("Not implemented");
  }
}

export class SpotifyService extends MusicService {
  constructor(options: MusicServiceOptions) {
    super(options);
  }

  public async getTrack(str: string): Promise<TrackInfo | null> {
    throw new Error("Not implemented");
  }

  public async search(options: { trackInfo: TrackInfo; accessToken?: string }) {
    const { trackInfo, accessToken } = options;
    // Use Spotify's field filters to search for artist and track separately
    const query = encodeURIComponent(
      `artist:${trackInfo.artist} track:${trackInfo.song}`
    );
    console.log("Searching Spotify with query:", query);
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
        {
          headers: {
            Authorization: `Bearer ${accessToken || this.accessToken}`,
          },
        }
      );
      const data = await res.json();
      console.log("searchSpotifyTrack data", data);

      if (data.tracks?.items?.length > 0) {
        return data.tracks.items[0].uri;
      }
    } catch (error) {
      console.error("Error searching Spotify:", error);
    }
    return null;
  }

  public async addToPlaylist(options: {
    playlistId: string;
    trackInfo: TrackInfo;
    accessToken: string;
  }): Promise<void> {
    const trackUri = await this.search({
      trackInfo: options.trackInfo,
      accessToken: options.accessToken,
    });
    if (!trackUri) {
      console.error("Track not found");
      return;
    }

    await fetch(
      `https://api.spotify.com/v1/playlists/${options.playlistId}/tracks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.accessToken}`,
        },
        body: JSON.stringify({ uris: [trackUri] }),
      }
    );
  }
}
