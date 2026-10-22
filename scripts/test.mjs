/**
 * Dependency-free test run.
 *
 *   node scripts/test.mjs
 *
 * Compiles `src/lib` + `tests` with the project's own TypeScript compiler and
 * runs Node's built-in test runner on the result — no extra packages needed.
 * The GitHub Actions workflow calls exactly this command.
 */

import { execSync } from "node:child_process";
import { rmSync, writeFileSync, existsSync } from "node:fs";

const OUT = ".test-dist";

rmSync(OUT, { recursive: true, force: true });

console.log("› compiling tests with tsc…");
execSync("npx tsc -p tsconfig.test.json", { stdio: "inherit" });

// The project is an ES module package; the test build emits CommonJS.
writeFileSync(`${OUT}/package.json`, JSON.stringify({ type: "commonjs" }, null, 2));

if (!existsSync(`${OUT}/tests`)) {
  console.error("test compilation produced no tests — failing the run");
  process.exit(1);
}

console.log("› running node --test…");
execSync(`node --test ${OUT}/tests`, { stdio: "inherit" });
