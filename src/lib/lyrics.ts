/**
 * Synced `.lrc` + plain embedded lyrics parser and time cursor lookup.
 */

export interface LyricLine {
  /** Timestamp in seconds (`null` for unsynced plain-text lyrics). */
  time: number | null;
  text: string;
}

export interface ParsedLyrics {
  synced: boolean;
  lines: LyricLine[];
}

const TIME_TAG_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG_RE = /^\[(ti|ar|al|by|re|ve|length|id):.*\]$/i;
const OFFSET_RE = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

export function parseLyrics(raw?: string | null): ParsedLyrics {
  if (!raw || !raw.trim()) return { synced: false, lines: [] };

  let offsetSeconds = 0;
  const timedLines: LyricLine[] = [];
  const plainLines: LyricLine[] = [];

  for (const rawLine of raw.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (plainLines.length > 0 && plainLines[plainLines.length - 1].text !== "") {
        plainLines.push({ time: null, text: "" });
      }
      continue;
    }

    const offsetMatch = trimmed.match(OFFSET_RE);
    if (offsetMatch) {
      offsetSeconds = Number(offsetMatch[1]) / 1000;
      continue;
    }
    if (META_TAG_RE.test(trimmed)) continue;

    TIME_TAG_RE.lastIndex = 0;
    const matches = Array.from(trimmed.matchAll(TIME_TAG_RE));
    if (matches.length > 0) {
      const content = trimmed.replace(TIME_TAG_RE, "").trim();
      for (const m of matches) {
        const mins = Number(m[1]);
        const secs = Number(m[2]);
        const fracRaw = m[3] ?? "0";
        const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
        const total = Math.max(0, mins * 60 + secs + frac - offsetSeconds);
        timedLines.push({ time: total, text: content || "· · ·" });
      }
    } else {
      plainLines.push({ time: null, text: trimmed });
    }
  }

  if (timedLines.length > 0) {
    timedLines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    return { synced: true, lines: timedLines };
  }

  return { synced: false, lines: plainLines };
}

/** Returns the index of the active lyric line at `positionSeconds`, or -1 before the first line. */
export function activeLyricIndex(lines: LyricLine[], positionSeconds: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time;
    if (t === null) continue;
    if (t <= positionSeconds + 0.08) active = i;
    else break;
  }
  return active;
}
