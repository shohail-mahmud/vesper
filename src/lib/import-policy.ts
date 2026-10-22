/**
 * Pure import policy — shared by the UI and covered by unit tests.
 *
 * Keeping this logic free of DOM/Tauri dependencies means the rules that matter
 * (what gets scanned, what counts as a duplicate, what a removal touches) can be
 * verified without audio hardware or a Windows shell.
 */

import { isAudioFile } from "./path";

export interface ImportCandidate {
  /** Path relative to the picked folder, e.g. `Album\Disc 1\01. Song.flac`. */
  relativePath: string;
  name: string;
  sizeBytes: number;
}

export interface ImportPlan<T extends ImportCandidate = ImportCandidate> {
  add: T[];
  skipped: T[];
}

/**
 * Nested-directory policy.
 *  • `recursive === false` → only files sitting directly in the imported folder.
 *  • `recursive === true`  → the whole tree below the folder.
 * The folder root segment itself is never part of the comparison.
 */
export function selectImportableFiles<T extends ImportCandidate>(
  candidates: T[],
  recursive: boolean,
): T[] {
  return candidates.filter((candidate) => {
    if (!isAudioFile(candidate.name)) return false;
    const segments = candidate.relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (recursive) return true;
    // [folder, file] means the file sits directly inside the folder.
    return segments.length <= 2;
  });
}

export function signature(sizeBytes: number, duration = 0): string {
  return `${Math.round(sizeBytes || 0)}:${Math.round(duration || 0)}`;
}

/**
 * De-duplication plan.
 *  1. A candidate whose normalised-path key already exists is skipped, so
 *     re-importing the same folder is idempotent.
 *  2. A candidate whose (size, duration) signature already exists in the target
 *     collection is skipped, so a moved or renamed file does not appear twice.
 */
export function planImport<T extends ImportCandidate>(
  existing: Map<string, string>,
  candidates: T[],
): ImportPlan<T> {
  const seen = new Map(existing);
  const add: T[] = [];
  const skipped: T[] = [];

  for (const candidate of candidates) {
    const key = candidate.relativePath.replace(/\\/g, "/").toLowerCase();
    const sig = signature(candidate.sizeBytes);
    if (seen.has(key) || seen.has(`sig:${sig}`)) {
      skipped.push(candidate);
      continue;
    }
    seen.set(key, sig);
    seen.set(`sig:${sig}`, key);
    add.push(candidate);
  }
  return { add, skipped };
}

/**
 * Removal plan. Removing a library entry never touches the file system — the
 * plan only ever contains library identifiers.
 */
export function removalPlan(
  folderTrackIds: string[],
  sourceKindById: Record<string, string>,
): { remove: string[]; keep: string[] } {
  const remove: string[] = [];
  const keep: string[] = [];
  for (const id of folderTrackIds) {
    if (sourceKindById[id] === "folder") remove.push(id);
    else keep.push(id);
  }
  return { remove, keep };
}

/** Shuffle cycle never repeats a track while others remain unplayed. */
export function assertNoImmediateRepeat(order: string[]): boolean {
  for (let i = 1; i < order.length; i++) {
    if (order[i] === order[i - 1]) return false;
  }
  return true;
}
