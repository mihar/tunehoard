import test from "node:test";
import assert from "node:assert/strict";
import { TrackTitleNormalizer } from "../TrackTitleNormalizer";

test("parses a standard Artist - Song title", () => {
  const result = TrackTitleNormalizer.parse("Daft Punk - One More Time");
  assert.deepEqual(result, {
    artist: "Daft Punk",
    song: "One More Time",
  });
});

test("standardizes featuring abbreviations in artist names", () => {
  const result = TrackTitleNormalizer.parse(
    "Major Lazer ft. DJ Snake - Lean On"
  );
  assert.deepEqual(result, {
    artist: "Major Lazer feat. DJ Snake",
    song: "Lean On",
  });
});

test("moves featuring credits into track parentheses", () => {
  const result = TrackTitleNormalizer.parse(
    "Calvin Harris - This Is What You Came For feat. Rihanna"
  );
  assert.equal(result?.song, "This Is What You Came For (feat. Rihanna)");
});

test("preserves meaningful remix information while stripping noise", () => {
  const result = TrackTitleNormalizer.parse(
    "Justice - D.A.N.C.E. (Live Remix) (Official Video) 2018"
  );
  assert.deepEqual(result, {
    artist: "Justice",
    song: "D.A.N.C.E. (Live Remix)",
  });
});

test("drops trailing metadata beyond the first pipe separator", () => {
  const result = TrackTitleNormalizer.parse(
    "LCD Soundsystem - All My Friends | Pitchfork Music Festival"
  );
  assert.deepEqual(result, {
    artist: "LCD Soundsystem",
    song: "All My Friends",
  });
});

test("returns null when an artist-song separator cannot be found", () => {
  const result = TrackTitleNormalizer.parse(
    "Random YouTube Title With No Dash"
  );
  assert.equal(result, null);
});
