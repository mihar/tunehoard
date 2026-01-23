import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "./config";
import { log } from "./logger";
import type { TrackInfo } from "./MusicService";

export type SmartMatchResult = {
  trackInfo: TrackInfo;
  confidence: number;
};

const SYSTEM_PROMPT = `You are a music track identifier. Given a YouTube video title and optionally a description, extract the artist name and song title.

Rules:
- Return ONLY valid JSON in this exact format: {"artist": "Artist Name", "song": "Song Title", "confidence": 0.9}
- The confidence field must be a number between 0 and 1 indicating how certain you are:
  - 1.0: Absolutely certain (e.g., official artist channel, explicit "Artist - Song" format)
  - 0.8-0.9: Very confident (clear artist/song in title, verified via search)
  - 0.6-0.7: Moderately confident (some ambiguity but likely correct)
  - 0.4-0.5: Low confidence (guessing based on partial info)
  - Below 0.4: Very uncertain (return null values instead)
- If you cannot determine both artist and song with reasonable confidence, return: {"artist": null, "song": null, "confidence": 0}
- Strip out things like "(Official Video)", "(Lyric Video)", "[HD]", "ft.", "feat." normalization, etc.
- For "feat." or "ft." artists, include them in the artist field like "Artist feat. Other Artist"
- Use Google Search if you need to verify or find the correct artist/song information
- Do not include any explanation, only the JSON object`;

export class SmartMatcher {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;

  constructor() {
    if (config.geminiApiKey) {
      this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
      this.model = this.genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        tools: [{ googleSearch: {} }] as any,
      });
    }
  }

  public isAvailable(): boolean {
    return this.model !== null;
  }

  public async match(title: string, description?: string): Promise<SmartMatchResult | null> {
    if (!this.model) {
      log("SmartMatcher not available - no API key configured");
      return null;
    }

    const prompt = description
      ? `YouTube Title: ${title}\n\nDescription:\n${description.slice(0, 1000)}`
      : `YouTube Title: ${title}`;

    log("SmartMatcher request", { title, hasDescription: !!description });

    try {
      const result = await this.model.generateContent({
        contents: [
          { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
          { role: "model", parts: [{ text: "I understand. Send me the YouTube video information and I will extract the artist and song in JSON format with my confidence level, using Google Search if needed." }] },
          { role: "user", parts: [{ text: prompt }] },
        ],
      });

      const response = result.response;
      const text = response.text();

      log("SmartMatcher raw response", { text });

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log("SmartMatcher failed to extract JSON", { text });
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.artist || !parsed.song) {
        log("SmartMatcher returned null values", { parsed });
        return null;
      }

      // Extract confidence, default to 0.5 if not provided (backward compat)
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

      const trackInfo: TrackInfo = {
        artist: parsed.artist,
        song: parsed.song,
      };

      log("SmartMatcher success", { trackInfo, confidence });
      return { trackInfo, confidence };
    } catch (error) {
      log("SmartMatcher error", { error: String(error) });
      return null;
    }
  }
}

export const smartMatcher = new SmartMatcher();
