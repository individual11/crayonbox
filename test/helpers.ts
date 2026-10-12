import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkStyle } from "../src/check.js";
import { formatIssues } from "../src/issues.js";

// fileURLToPath, not import.meta.dirname: that needs Node 20.11, and the package supports all of 20.
export const root = fileURLToPath(new URL("..", import.meta.url));
export const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** "line N: message" for each problem, the way the CLI prints them. */
export const problems = (text: string) => {
  const out = formatIssues(checkStyle(text).issues);
  return out ? out.split("\n") : [];
};

/** A style line followed by some lines: the style line is line 1, the first given line is line 2. */
export const style = (...lines: string[]) => ['style "Test"', ...lines].join("\n");

/** The same with light and dark modes. */
export const twoModes = (...lines: string[]) => ['style "Test" modes=light,dark', ...lines].join("\n");

/** The one problem a style has. */
export const only = (text: string) => {
  const p = problems(text);
  assert.equal(p.length, 1, p.join("\n") || "no problems");
  return p[0];
};
