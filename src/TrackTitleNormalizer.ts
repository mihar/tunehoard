import type { TrackInfo, ParsedTrackData } from "./MusicService";
import { log } from "./logger";

export class TrackTitleNormalizer {
  private static readonly EXTRANEOUS_TAG_REGEX =
    /\b(?:official(?:\s+music)?\s+video|official\s+audio|official|lyrics?|audio|visualizer|mv|live|performance|cover|karaoke|instrumental|prod\.?|remaster(?:ed)?|hd|hq)\b/gi;

  public static parse(title: string): TrackInfo | null {
    if (!title) {
      log("TrackTitleNormalizer: empty title");
      return null;
    }

    const normalizedTitle = TrackTitleNormalizer.normalizeWhitespace(
      TrackTitleNormalizer.extractPrimaryTitleSegment(
        title.replace(/[–—]/g, "-")
      )
    );

    log("TrackTitleNormalizer: normalized", { original: title, normalized: normalizedTitle });

    const parts = normalizedTitle.split(/\s*-\s*/);
    if (parts.length < 2) {
      log("TrackTitleNormalizer: no hyphen separator found", { normalizedTitle, parts });
      return null;
    }

    const artistRaw = parts.shift();
    const songRaw = parts.join(" - ");
    const artist = TrackTitleNormalizer.normalizeArtistName(artistRaw ?? "");
    const song = TrackTitleNormalizer.normalizeTrackName(songRaw);

    log("TrackTitleNormalizer: extracted", { artistRaw, songRaw, artist, song });

    if (!artist || !song) {
      log("TrackTitleNormalizer: empty artist or song after normalization");
      return null;
    }

    return { artist, song };
  }

  /**
   * Normalize a title and optionally extract artist/song.
   * Always returns something (at minimum, the cleaned-up raw title).
   */
  public static normalize(title: string, description?: string): ParsedTrackData {
    if (!title) {
      return { rawTitle: "" };
    }

    const normalizedTitle = TrackTitleNormalizer.normalizeWhitespace(
      TrackTitleNormalizer.extractPrimaryTitleSegment(
        title.replace(/[–—]/g, "-")
      )
    );

    // Try to parse "Artist - Song" format
    const parsed = TrackTitleNormalizer.parse(title);

    if (parsed) {
      return {
        rawTitle: normalizedTitle,
        rawDescription: description,
        artist: parsed.artist,
        song: parsed.song,
      };
    }

    // Couldn't parse, just return the cleaned title
    return {
      rawTitle: normalizedTitle,
      rawDescription: description,
    };
  }

  private static normalizeArtistName(name: string): string {
    const standardized = TrackTitleNormalizer.standardizeFeaturing(name);
    return TrackTitleNormalizer.normalizeWhitespace(standardized);
  }

  private static normalizeTrackName(name: string): string {
    let normalized = TrackTitleNormalizer.standardizeFeaturing(name);
    normalized = TrackTitleNormalizer.removeBracketedDescriptors(normalized);
    normalized = normalized.replace(
      TrackTitleNormalizer.EXTRANEOUS_TAG_REGEX,
      (match: string, offset: number, input: string) => {
        if (
          TrackTitleNormalizer.shouldPreserveExtraneousTag(
            input,
            offset,
            match.length
          )
        ) {
          return match;
        }
        return " ";
      }
    );
    normalized = TrackTitleNormalizer.stripYearSuffixes(normalized);
    normalized = TrackTitleNormalizer.normalizeWhitespace(normalized);
    normalized = TrackTitleNormalizer.normalizeFeaturingPlacement(normalized);
    return TrackTitleNormalizer.normalizeWhitespace(normalized);
  }

  private static normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private static extractPrimaryTitleSegment(value: string): string {
    if (!value.includes("|")) {
      return value;
    }
    return value.split("|")[0]?.trim() ?? value;
  }

  private static standardizeFeaturing(value: string): string {
    return value
      .replace(/\b(feat|ft|featuring)\.?/gi, "feat.")
      .replace(/feat\.\./gi, "feat.");
  }

  private static removeBracketedDescriptors(value: string): string {
    return value.replace(
      /\s*[\(\[\{]([^)\]\}]*)[\)\]\}]\s*/g,
      (match, inner) => {
        if (TrackTitleNormalizer.isExtraneousDescriptor(inner)) {
          return " ";
        }
        return ` (${inner.trim()}) `;
      }
    );
  }

  private static stripYearSuffixes(value: string): string {
    return value
      .replace(/\s*[-–—]\s*(?:19|20)\d{2}\s*$/g, " ")
      .replace(/\s+(?:19|20)\d{2}\s*$/g, " ")
      .replace(/\s*[\(\[\{]\s*(?:19|20)\d{2}\s*[\)\]\}]\s*/g, " ");
  }

  private static normalizeFeaturingPlacement(value: string): string {
    const featuringMatch = value.match(/\bfeat\.\s+(.+)/i);
    if (!featuringMatch || value.includes("(feat.")) {
      return value;
    }

    const base = value.slice(0, featuringMatch.index ?? 0).trim();
    const featuredArtists = featuringMatch[1].trim();
    if (!base) {
      return value;
    }

    return `${base} (feat. ${featuredArtists})`;
  }

  private static isExtraneousDescriptor(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) {
      return true;
    }

    if (/(remix|mix|edit|version|feat\.)/i.test(normalized)) {
      return false;
    }

    TrackTitleNormalizer.EXTRANEOUS_TAG_REGEX.lastIndex = 0;
    return TrackTitleNormalizer.EXTRANEOUS_TAG_REGEX.test(normalized);
  }

  private static shouldPreserveExtraneousTag(
    value: string,
    offset: number,
    length: number
  ): boolean {
    const before = value.slice(0, offset);
    const openIndex = before.lastIndexOf("(");
    if (openIndex === -1) {
      return false;
    }

    const closeIndex = value.indexOf(")", openIndex);
    if (closeIndex !== -1 && closeIndex < offset) {
      return false;
    }

    const segment = value.slice(
      openIndex + 1,
      closeIndex === -1 ? offset + length : closeIndex
    );

    return /(remix|mix|edit|version)/i.test(segment);
  }
}
