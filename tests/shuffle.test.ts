import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQueue,
  nextIndex,
  previousIndex,
  shuffleArray,
  shuffleIndices,
} from "../src/lib/shuffle";
import { assertNoImmediateRepeat } from "../src/lib/import-policy";

/** Deterministic LCG so the assertions are stable in CI. */
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test("shuffle is a permutation of every index, exactly once", () => {
  const rng = seeded(7);
  const order = shuffleIndices(24, rng);
  assert.equal(order.length, 24);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i));
});

test("shuffle does not produce immediate repeats across many cycles", () => {
  const rng = seeded(1234);
  for (let cycle = 0; cycle < 200; cycle++) {
    const order = shuffleArray(["a", "b", "c", "d", "e", "f"], rng);
    assert.ok(assertNoImmediateRepeat(order), `immediate repeat in cycle ${cycle}: ${order}`);
  }
});

test("shuffle keeps the current track first when re-shuffling mid-playback", () => {
  const rng = seeded(99);
  const base = ["a", "b", "c", "d", "e"];
  for (let i = 0; i < 50; i++) {
    const queue = buildQueue(base, true, "c", (id) => id, rng);
    assert.equal(queue[0], "c");
    assert.equal(queue.length, base.length);
  }
});

test("disabling shuffle restores the intended playlist order", () => {
  const base = ["a", "b", "c", "d", "e"];
  const queue = buildQueue(base, false, "d", (id) => id, seeded(3));
  assert.deepEqual(queue, base);
});

test("nextIndex advances, wraps under repeat-all and stops under repeat-off", () => {
  assert.equal(nextIndex(0, 3, "off"), 1);
  assert.equal(nextIndex(2, 3, "off"), null);
  assert.equal(nextIndex(2, 3, "all"), 0);
  assert.equal(nextIndex(1, 3, "one", false), 2);
  assert.equal(nextIndex(1, 3, "one", true), 1);
  assert.equal(nextIndex(0, 0, "all"), null);
});

test("previousIndex restarts the track after 3 seconds", () => {
  assert.equal(previousIndex(4, 12), "restart");
  assert.equal(previousIndex(4, 1), 3);
  assert.equal(previousIndex(0, 1), "restart");
});
