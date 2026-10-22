import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artistFromFileName,
  folderFromRelativePath,
  isAudioFile,
  normalizePath,
  stripExtension,
  titleFromFileName,
  trackKey,
} from "../src/lib/path";
import { selectImportableFiles, planImport, removalPlan, signature } from "../src/lib/import-policy";
import { formatTime, percent } from "../src/lib/format";

test("normalised paths treat separators and case as identical", () => {
  assert.equal(
    normalizePath("C:\\Users\\You\\Music\\Album\\01.flac"),
    normalizePath("c:/users/you/music/album/01.flac"),
  );
  assert.equal(normalizePath("C:/Music/./Album/../Album/a.mp3"), "c:/music/album/a.mp3");
});

test("the same file re-imported resolves to the same track key (no duplicates)", () => {
  const a = trackKey("C:\\Music\\Album\\01. Song.mp3");
  const b = trackKey("C:/Music/album/01. SONG.mp3");
  assert.equal(a, b);
});

test("a different file gets a different key", () => {
  assert.notEqual(trackKey("C:\\Music\\a.mp3"), trackKey("C:\\Music\\b.mp3"));
});

test("file name fallbacks are used only when tags are missing", () => {
  assert.equal(titleFromFileName("C:\\Music\\03. Artist - Title.flac"), "Title");
  assert.equal(stripExtension("song.m4a"), "song");
  assert.equal(artistFromFileName("03. Ilse Varga - Aubade.flac"), "Ilse Varga");
  assert.equal(artistFromFileName("untitled tape loop.wav"), undefined);
});

test("supported extensions are recognised and others are rejected", () => {
  for (const ext of ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"]) {
    assert.ok(isAudioFile(`track.${ext}`), ext);
  }
  assert.equal(isAudioFile("notes.txt"), false);
  assert.equal(isAudioFile("cover.jpg"), false);
});

test("folder picker paths identify the chosen folder and nesting depth", () => {
  const info = folderFromRelativePath("Nocturne Sessions/Disc 1/01. Slow Glass.flac");
  assert.equal(info.folder, "Nocturne Sessions");
  assert.deepEqual(info.nested, ["Disc 1"]);
});

test("top-level scan ignores nested directories, recursive scan includes them", () => {
  const candidates = [
    { relativePath: "Album/01. A.mp3", name: "01. A.mp3", sizeBytes: 10 },
    { relativePath: "Album/Disc 2/02. B.mp3", name: "02. B.mp3", sizeBytes: 20 },
    { relativePath: "Album/notes.txt", name: "notes.txt", sizeBytes: 5 },
  ];
  const topLevel = selectImportableFiles(candidates, false);
  assert.equal(topLevel.length, 1, "nested files are ignored at the top level");
  assert.equal(topLevel[0].name, "01. A.mp3");

  const recursive = selectImportableFiles(candidates, true);
  assert.equal(recursive.length, 2, "recursive scan reaches nested audio but never non-audio files");
  assert.ok(recursive.some((c) => c.relativePath.includes("Disc 2")));
});

test("re-importing the same folder adds nothing new", () => {
  const candidates = [
    { relativePath: "Album/01. A.mp3", name: "01. A.mp3", sizeBytes: 10 },
    { relativePath: "Album/02. B.mp3", name: "02. B.mp3", sizeBytes: 20 },
  ];
  const first = planImport(new Map(), candidates);
  assert.equal(first.add.length, 2);

  const existing = new Map<string, string>();
  for (const item of first.add) {
    const key = item.relativePath.replace(/\\/g, "/").toLowerCase();
    existing.set(key, signature(item.sizeBytes));
    existing.set(`sig:${signature(item.sizeBytes)}`, key);
  }
  const second = planImport(existing, candidates);
  assert.equal(second.add.length, 0);
  assert.equal(second.skipped.length, 2);
});

test("a moved or renamed file is not added twice", () => {
  const original = [{ relativePath: "Album/01. A.mp3", name: "01. A.mp3", sizeBytes: 4096 }];
  const moved = [{ relativePath: "Album (moved)/renamed.mp3", name: "renamed.mp3", sizeBytes: 4096 }];
  const first = planImport(new Map(), original);
  const existing = new Map<string, string>();
  for (const item of first.add) {
    const key = item.relativePath.replace(/\\/g, "/").toLowerCase();
    existing.set(`sig:${signature(item.sizeBytes)}`, key);
  }
  const second = planImport(existing, moved);
  assert.equal(second.add.length, 0, "same size signature should be treated as a duplicate");
});

test("removing a folder entry only removes library identifiers, never paths", () => {
  const plan = removalPlan(["a", "b", "c"], { a: "folder", b: "folder", c: "loose" });
  assert.deepEqual(plan.remove, ["a", "b"]);
  assert.deepEqual(plan.keep, ["c"]);
});

test("timecodes stay tabular and tolerate unknown durations", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(187), "3:07");
  assert.equal(formatTime(3661), "1:01:01");
  assert.equal(formatTime(undefined), "--:--");
  assert.equal(formatTime(Number.NaN), "--:--");
});

test("progress percentage is clamped to 0..100", () => {
  assert.equal(percent(30, 120), 25);
  assert.equal(percent(200, 120), 100);
  assert.equal(percent(10, 0), 0);
});
