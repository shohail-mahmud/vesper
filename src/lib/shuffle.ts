/**
 * Playback order helpers.
 *
 * Shuffle policy: a full Fisher–Yates permutation of the queue. The currently
 * playing track is kept at the head when re-shuffling mid-session so the user
 * does not get bounced to a different song. No track repeats inside one shuffle
 * cycle — only when the cycle is exhausted does it wrap (and only if repeat-all
 * is on). Pure functions with an injectable RNG so they are unit-testable
 * without audio hardware.
 */

export type Rng = () => number;

export function shuffleIndices(length: number, rng: Rng = Math.random, keepFirst = false): number[] {
  const out = Array.from({ length }, (_, i) => i);
  const start = keepFirst && length > 1 ? 1 : 0;
  for (let i = length - 1; i > start; i--) {
    const j = start + Math.floor(rng() * (i - start + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function shuffleArray<T>(items: T[], rng: Rng = Math.random, keepFirst = false): T[] {
  return shuffleIndices(items.length, rng, keepFirst).map((i) => items[i]);
}

/**
 * Rebuild a play order from a base order for the given shuffle state.
 * `currentId` stays first when shuffle is switched on mid-playback.
 */
export function buildQueue<T>(
  base: T[],
  shuffleOn: boolean,
  current: T | null,
  getId: (item: T) => string,
  rng: Rng = Math.random,
): T[] {
  if (!shuffleOn) return [...base];
  const rest = current ? base.filter((t) => getId(t) !== getId(current)) : [...base];
  const shuffled = shuffleArray(rest, rng);
  return current ? [current, ...shuffled] : shuffled;
}

/** Next index under the given repeat policy. Returns null when playback ends. */
export function nextIndex(
  index: number,
  length: number,
  repeat: "off" | "all" | "one",
  autoAdvance = true,
): number | null {
  if (length === 0) return null;
  if (repeat === "one") return autoAdvance ? index : (index + 1) % length;
  const candidate = index + 1;
  if (candidate < length) return candidate;
  return repeat === "all" ? 0 : null;
}

/** Previous index, honouring "restart current track after 3s" semantics. */
export function previousIndex(index: number, position: number, restartAfterSeconds = 3): "restart" | number | null {
  if (position > restartAfterSeconds) return "restart";
  if (index <= 0) return "restart";
  return index - 1;
}
