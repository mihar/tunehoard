import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "./config";
import { log } from "./logger";
import type { TrackInfo } from "./MusicService";

const SYSTEM_PROMPT = `You are a music track identifier. Given a YouTube video title and optionally a description, extract the artist name and song title.

Rules:
- Return ONLY valid JSON in this exact format: {"artist": "Artist Name", "song": "Song Title"}
- If you cannot determine both artist and song with confidence, return: {"artist": null, "song": null}
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

  public async match(title: string, description?: string): Promise<TrackInfo | null> {
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
          { role: "model", parts: [{ text: "I understand. Send me the YouTube video information and I will extract the artist and song in JSON format, using Google Search if needed." }] },
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

      const trackInfo: TrackInfo = {
        artist: parsed.artist,
        song: parsed.song,
      };

      log("SmartMatcher success", { trackInfo });
      return trackInfo;
    } catch (error) {
      log("SmartMatcher error", { error: String(error) });
      return null;
    }
  }
}

export const smartMatcher = new SmartMatcher();
