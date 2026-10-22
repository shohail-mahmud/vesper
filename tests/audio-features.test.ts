import { strict as assert } from "node:assert";
import { test } from "node:test";
import { activeLyricIndex, parseLyrics } from "../src/lib/lyrics";
import { clampDb, normalizeEq, presetToEq } from "../src/lib/eq";

test("parseLyrics extracts sorted timestamps, handles offsets, and ignores metadata tags", () => {
  const sample = [
    "[ti:Looped]",
    "[ar:Kiasmos]",
    "[offset:500]",
    "[00:05.00] First line",
    "[00:12.50] Second line",
  ].join("\n");

  const parsed = parseLyrics(sample);
  assert.equal(parsed.synced, true);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].time, 4.5);
  assert.equal(parsed.lines[0].text, "First line");
  assert.equal(parsed.lines[1].time, 12.0);

  assert.equal(activeLyricIndex(parsed.lines, 2.0), -1);
  assert.equal(activeLyricIndex(parsed.lines, 4.6), 0);
  assert.equal(activeLyricIndex(parsed.lines, 13.0), 1);
});

test("parseLyrics falls back to unsynced lines cleanly for plain embedded lyrics", () => {
  const parsed = parseLyrics("Verse one\nStill waters");
  assert.equal(parsed.synced, false);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].time, null);
});

test("equalizer presets and clamping stay bounded in -12..+12 dB", () => {
  const bass = presetToEq("bass_boost");
  assert.equal(bass.enabled, true);
  assert.equal(bass.bands.length, 10);
  assert.ok(bass.bands[0] > 0);
  assert.equal(clampDb(42), 12);
  assert.equal(clampDb(-30), -12);

  const normalized = normalizeEq({ enabled: true, preset: "custom", preamp: 19, bands: [15, -20] });
  assert.equal(normalized.preamp, 12);
  assert.equal(normalized.bands.length, 10);
  assert.equal(normalized.bands[0], 12);
  assert.equal(normalized.bands[1], -12);
  assert.equal(normalized.bands[5], 0);
});
