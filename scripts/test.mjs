/**
 * Cross-platform (Windows / macOS / Linux) dependency-free test runner.
 *
 *   node scripts/test.mjs
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = ".test-dist";

rmSync(OUT, { recursive: true, force: true });

console.log("› compiling tests with tsc…");
execSync("npx tsc -p tsconfig.test.json", { stdio: "inherit" });

writeFileSync(`${OUT}/package.json`, JSON.stringify({ type: "commonjs" }, null, 2));

const testDir = resolve(OUT, "tests");
if (!existsSync(testDir)) {
  console.error("test compilation produced no tests — failing the run");
  process.exit(1);
}

const testFiles = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => resolve(testDir, name));

if (testFiles.length === 0) {
  console.error("no compiled *.test.js files found — failing the run");
  process.exit(1);
}

console.log(`› running node --test on ${testFiles.length} suite(s)…`);
const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
