/**
 * The guide renders for real files, offline (no font fetching in tests), and refuses
 * a style with errors. What it looks like is checked by eye (see CLAUDE.md).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStyle } from "../src/check.js";
import { loadFonts } from "../src/fonts.js";
import { renderStyle, StyleError } from "../src/render.js";
import { read, style } from "./helpers.js";

const size = (svg: string) => svg.match(/^<svg width="(\d+)" height="(\d+)"/)!.slice(1).map(Number);

test("the example renders as one tall board", async () => {
  const svg = await renderStyle(read("examples/field-notes.crayon"), { fetch: false });
  const [w, h] = size(svg);
  assert.equal(w, 1200);
  assert.ok(h > 5000, `height ${h}`);
});

test("every family renders", async () => {
  const svg = await renderStyle(read("test/fixtures/everything.crayon"), { fetch: false });
  assert.ok(size(svg)[1] > 5000);
});

test("an empty style renders its defaults", async () => {
  const svg = await renderStyle('style "Empty"', { fetch: false });
  assert.equal(size(svg)[0], 1200);
});

test("a style with errors isn't drawn", async () => {
  await assert.rejects(renderStyle(style("color", "  surface white"), { fetch: false }), (e: unknown) => e instanceof StyleError && /line 3: white/.test(e.message));
});

test("fonts that can't be drawn are labeled stand-ins", async () => {
  const s = checkStyle(style('font', '  serif "Source Serif 4"', '  sys "system"', '  ui "Inter"')).style!;
  const { uses } = await loadFonts(s, { fetch: false });
  assert.deepEqual(
    Object.fromEntries([...uses].map(([k, v]) => [k, v.note ?? v.drawAs])),
    {
      serif: "Source Serif 4 not fetched; shown in Inter",
      sys: "the system font isn't on Google Fonts; shown in Inter",
      ui: "Inter",
      // The code style needs a mono font, so the default one is added.
      mono: "JetBrains Mono not fetched; shown in Inter",
    },
  );
});
