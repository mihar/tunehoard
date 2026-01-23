import { MusicService, type ParsedTrackData, type SearchMatch } from "./MusicService";
import { smartMatcher } from "./SmartMatcher";
import { log } from "./logger";

const CONFIDENCE_THRESHOLD = 0.5;
const SMART_MATCH_CONFIDENCE_THRESHOLD = 0.6;

export type TokenGetter = (serviceName: string) => string | null;
export type TokenRefresher = (serviceName: string) => Promise<string | null>;

export class TrackMatcher {
  /**
   * Try to find a match for the parsed track data across available services.
   *
   * Flow:
   * 1. Try each service's searchTrack with the parsed data
   * 2. If token expired, refresh and retry
   * 3. If no confident match and smart matching is available, enrich with AI
   * 4. Re-run search with enriched data
   */
  async match(
    parsedData: ParsedTrackData,
    services: MusicService[],
    getToken: TokenGetter,
    options: { useSmartMatching?: boolean; refreshToken?: TokenRefresher } = {}
  ): Promise<SearchMatch | null> {
    const { useSmartMatching = false, refreshToken } = options;

    log("TrackMatcher starting", {
      rawTitle: parsedData.rawTitle,
      hasArtist: !!parsedData.artist,
      hasSong: !!parsedData.song,
      serviceCount: services.length,
      useSmartMatching,
    });

    // Track refreshed tokens so we don't refresh multiple times
    const refreshedTokens = new Map<string, string>();

    // Helper to get token (uses refreshed if available)
    const getEffectiveToken = (serviceName: string): string | null => {
      return refreshedTokens.get(serviceName) ?? getToken(serviceName);
    };

    // 1. Try each service's search
    for (const service of services) {
      let token = getEffectiveToken(service.name);
      if (!token) {
        log("TrackMatcher skipping service - no token", { service: service.name });
        continue;
      }

      try {
        let result = await service.searchTrack(parsedData, token);

        // If token expired, try to refresh and retry
        if (result.needsReauth && refreshToken) {
          log("TrackMatcher token expired, attempting refresh", { service: service.name });
          const newToken = await refreshToken(service.name);
          if (newToken) {
            refreshedTokens.set(service.name, newToken);
            result = await service.searchTrack(parsedData, newToken);
          }
        }

        if (result.match && result.match.confidence >= CONFIDENCE_THRESHOLD) {
          log("TrackMatcher found confident match", {
            service: service.name,
            artist: result.match.trackInfo.artist,
            song: result.match.trackInfo.song,
            confidence: result.match.confidence,
          });
          return result.match;
        }

        if (result.match) {
          log("TrackMatcher found low-confidence match", {
            service: service.name,
            confidence: result.match.confidence,
          });
        }
      } catch (error) {
        log("TrackMatcher service search error", {
          service: service.name,
          error: String(error),
        });
      }
    }

    // 2. If no confident match, try smart matching
    if (useSmartMatching && smartMatcher.isAvailable()) {
      log("TrackMatcher attempting smart matching", {
        rawTitle: parsedData.rawTitle,
        hasDescription: !!parsedData.rawDescription,
      });

      try {
        const smartResult = await smartMatcher.match(
          parsedData.rawTitle,
          parsedData.rawDescription
        );

        if (smartResult && smartResult.confidence < SMART_MATCH_CONFIDENCE_THRESHOLD) {
          log("TrackMatcher smart matching returned low confidence - skipping", {
            artist: smartResult.trackInfo.artist,
            song: smartResult.trackInfo.song,
            aiConfidence: smartResult.confidence,
            threshold: SMART_MATCH_CONFIDENCE_THRESHOLD,
          });
        }

        if (smartResult && smartResult.confidence >= SMART_MATCH_CONFIDENCE_THRESHOLD) {
          log("TrackMatcher smart matching enriched data", {
            artist: smartResult.trackInfo.artist,
            song: smartResult.trackInfo.song,
            aiConfidence: smartResult.confidence,
          });

          const enriched = smartResult.trackInfo;

          // Re-run search with enriched data
          const enrichedData: ParsedTrackData = {
            ...parsedData,
            artist: enriched.artist,
            song: enriched.song,
          };

          for (const service of services) {
            let token = getEffectiveToken(service.name);
            if (!token) continue;

            try {
              let result = await service.searchTrack(enrichedData, token);

              // If token expired, try to refresh and retry
              if (result.needsReauth && refreshToken) {
                log("TrackMatcher token expired during enriched search, attempting refresh", { service: service.name });
                const newToken = await refreshToken(service.name);
                if (newToken) {
                  refreshedTokens.set(service.name, newToken);
                  result = await service.searchTrack(enrichedData, newToken);
                }
              }

              if (result.match && result.match.confidence >= CONFIDENCE_THRESHOLD) {
                log("TrackMatcher found match after smart enrichment", {
                  service: service.name,
                  artist: result.match.trackInfo.artist,
                  song: result.match.trackInfo.song,
                  confidence: result.match.confidence,
                });
                return result.match;
              }
            } catch (error) {
              log("TrackMatcher enriched search error", {
                service: service.name,
                error: String(error),
              });
            }
          }
        }
      } catch (error) {
        log("TrackMatcher smart matching error", { error: String(error) });
      }
    }

    log("TrackMatcher no match found", { rawTitle: parsedData.rawTitle });
    return null;
  }
}

export const trackMatcher = new TrackMatcher();
