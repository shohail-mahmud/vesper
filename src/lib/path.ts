/**
 * Path + track identity helpers.
 *
 * Identity policy (documented, and covered by tests in `path.test.ts`):
 *  1. Primary key = FNV-1a hash of the *normalised* path — separators unified,
 *     case folded, redundant segments collapsed. Re-importing the same file is
 *     therefore a no-op instead of a duplicate library entry.
 *  2. Secondary guard = (sizeBytes, duration) signature, so the same file that
 *     was moved or renamed does not end up twice in the same playlist.
 */

export function normalizePath(input: string): string {
  if (!input) return "";
  let p = input.replace(/\\/g, "/");
  // strip Windows drive letter casing + file:// prefix
  p = p.replace(/^file:\/\//i, "");
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const joined = parts.join("/");
  return joined.toLowerCase();
}

export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

export function trackKey(path: string): string {
  return hashString(normalizePath(path));
}

export function signatureKey(sizeBytes: number, duration: number): string {
  return `${Math.round(sizeBytes || 0)}:${Math.round(duration || 0)}`;
}

export function fileName(path: string): string {
  const p = (path || "").replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1);
}

export function dirName(path: string): string {
  const p = (path || "").replace(/\\/g, "/");
  return p.slice(0, p.lastIndexOf("/"));
}

export function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "aiff",
  "aif",
];

export function isAudioFile(name: string): boolean {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return AUDIO_EXTENSIONS.includes(ext);
}

export const SUPPORTED_EXTENSIONS = AUDIO_EXTENSIONS;

/**
 * "03. Artist - Title.mp3" / "Title.flac" → a readable title.
 * Only used when no embedded title tag exists.
 */
export function titleFromFileName(name: string): string {
  let base = stripExtension(fileName(name));
  base = base.replace(/^\s*\d{1,3}[\s._-]+/, ""); // leading track number
  base = base.replace(/_/g, " ").trim();
  if (!base) return fileName(name);
  // "03. Artist - Title" → "Title", matching what `artistFromFileName` returns
  // as the artist so the two fallbacks never overlap.
  const parts = base.split(/\s+-\s+/);
  return parts.length >= 2 ? parts[parts.length - 1].trim() : base;
}

/** "03. Artist - Title.mp3" → "Artist" when no tag exists. Never guessed otherwise. */
export function artistFromFileName(name: string): string | undefined {
  const base = stripExtension(fileName(name)).replace(/^\s*\d{1,3}[\s._-]+/, "");
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2 && parts[0].trim().length > 1) return parts[0].trim();
  return undefined;
}

/** First folder segment of a webkitdirectory selection (the chosen folder). */
export function folderFromRelativePath(relativePath: string): { folder: string; nested: string[] } {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return { folder: parts[0] ?? "", nested: parts.slice(1, -1) };
}
