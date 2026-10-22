/**
 * Minimal, dependency-free ID3 reader used by the browser preview build.
 *
 * The desktop (Tauri) build extracts the same fields in Rust with `lofty`
 * (`src-tauri/src/metadata.rs`). Nothing here is guessed: if a file has no
 * tags the caller falls back to the file name, and `artist` stays undefined.
 *
 * Reads only the leading tag block (max 2 MiB) — never the whole audio file —
 * so importing a large folder cannot stall the UI on artwork decoding.
 */

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  trackNumber?: string;
  /** Raw image bytes for embedded artwork (APIC). */
  artwork?: Uint8Array;
  artworkMime?: string;
}

const MAX_TAG_BLOCK = 2 * 1024 * 1024;

function decodeText(bytes: Uint8Array, encoding: number): string {
  if (bytes.length === 0) return "";
  try {
    if (encoding === 0) return new TextDecoder("windows-1252").decode(bytes).replace(/\0+$/, "");
    if (encoding === 1) return new TextDecoder("utf-16").decode(bytes).replace(/\0+$/, "");
    if (encoding === 2) return new TextDecoder("utf-16be").decode(bytes).replace(/\0+$/, "");
    return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/, "");
  } catch {
    return "";
  }
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function synchsafe(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function readTerminated(
  bytes: Uint8Array,
  start: number,
  encoding: number,
): { value: string; next: number } {
  const wide = encoding === 1 || encoding === 2;
  let i = start;
  while (i < bytes.length - 1) {
    if (wide) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        return { value: decodeText(bytes.slice(start, i), encoding), next: i + 2 };
      }
      i += 2;
    } else {
      if (bytes[i] === 0) return { value: decodeText(bytes.slice(start, i), encoding), next: i + 1 };
      i += 1;
    }
  }
  return { value: decodeText(bytes.slice(start), encoding), next: bytes.length };
}

function parsePicture(frame: Uint8Array, version: number): { artwork: Uint8Array; mime: string } | null {
  if (frame.length < 6) return null;
  const encoding = frame[0];
  let cursor = 1;
  let mime = "image/jpeg";
  if (version === 2) {
    mime = latin1(frame.slice(1, 4)).toLowerCase() === "png" ? "image/png" : "image/jpeg";
    cursor = 4;
  } else {
    const end = frame.indexOf(0, cursor);
    if (end < 0) return null;
    mime = latin1(frame.slice(cursor, end)) || "image/jpeg";
    cursor = end + 1;
  }
  cursor += 1; // picture type byte
  const desc = readTerminated(frame, cursor, encoding);
  const dataStart = desc.next;
  if (dataStart >= frame.length) return null;
  return { artwork: frame.slice(dataStart), mime };
}

export function parseId3Block(buffer: ArrayBuffer): AudioTags | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || latin1(bytes.slice(0, 3)) !== "ID3") return null;
  const version = bytes[3];
  const view = new DataView(buffer);
  const tagSize = synchsafe(view, 6);
  const end = Math.min(bytes.length, 10 + tagSize);
  const tags: AudioTags = {};
  let cursor = 10;
  const hasExtendedHeader = (bytes[5] & 0x40) !== 0;
  if (hasExtendedHeader && end - cursor > 4) {
    const extSize = version === 4 ? synchsafe(view, cursor) : view.getUint32(cursor, false);
    cursor += extSize + 4;
  }

  while (cursor < end - 10) {
    const idLen = version === 2 ? 3 : 4;
    const id = latin1(bytes.slice(cursor, cursor + idLen));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let size: number;
    if (version === 2) {
      size = (bytes[cursor + 3] << 16) | (bytes[cursor + 4] << 8) | bytes[cursor + 5];
      cursor += 6;
    } else {
      size = version === 4 ? synchsafe(view, cursor + 4) : view.getUint32(cursor + 4, false);
      cursor += 10;
    }
    if (size <= 0 || cursor + size > end) break;
    const frame = bytes.slice(cursor, cursor + size);
    cursor += size;

    const isText = /^T/.test(id) && id !== "TXXX";
    if (isText && frame.length > 1) {
      const value = decodeText(frame.slice(1), frame[0]).trim();
      if (!value) continue;
      if (id === "TIT2" || id === "TT2") tags.title = value;
      else if (id === "TPE1" || id === "TP1") tags.artist = value;
      else if (id === "TALB" || id === "TAL") tags.album = value;
      else if (id === "TYER" || id === "TYE" || id === "TDRC") tags.year = value;
      else if (id === "TRCK" || id === "TRK") tags.trackNumber = value;
      continue;
    }
    if ((id === "APIC" || id === "PIC") && !tags.artwork) {
      const pic = parsePicture(frame, version);
      if (pic) {
        tags.artwork = pic.artwork;
        tags.artworkMime = pic.mime;
      }
    }
  }
  return tags;
}

/** Reads only the tail ID3v1 block (128 bytes) as a last-resort fallback. */
export async function readId3v1(file: File): Promise<AudioTags | null> {
  if (file.size < 128) return null;
  const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
  if (latin1(tail.slice(0, 3)) !== "TAG") return null;
  const clean = (b: Uint8Array) => decodeText(b, 0).replace(/\0+$/, "").trim();
  return {
    title: clean(tail.slice(3, 33)) || undefined,
    artist: clean(tail.slice(33, 63)) || undefined,
    album: clean(tail.slice(63, 93)) || undefined,
  };
}

export async function readTags(file: File): Promise<AudioTags> {
  const head = await file.slice(0, Math.min(file.size, MAX_TAG_BLOCK)).arrayBuffer();
  const fromHeader = parseId3Block(head);
  const fromTail = fromHeader ? null : await readId3v1(file);
  return { ...(fromTail ?? {}), ...(fromHeader ?? {}) };
}

/** Data URL for a small artwork thumbnail (keeps widget memory bounded). */
export function artworkDataUrl(bytes: Uint8Array, mime = "image/jpeg"): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
