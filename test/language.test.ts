/**
 * The language as the guide describes it: the example file, defaults, modes, the
 * automatic on- colors, generated type and space, and the summary `check` prints.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStyle, formatSummary } from "../src/check.js";
import { toHex } from "../src/color.js";
import { read, style, twoModes } from "./helpers.js";

const example = checkStyle(read("examples/field-notes.crayon"));
const role = (name: string, s = example.style!) => s.roles.find((r) => r.name === name)!;
const hex = (name: string, mode: string, s = example.style!) => toHex(role(name, s).colors[mode]);

test("the example checks clean", () => {
  assert.deepEqual(example.issues, []);
});

test("the example's summary", () => {
  assert.equal(
    formatSummary(example.summary!),
    [
      "Field Notes · 3 modes · 9 roles · 8 type styles · 2 components",
      "contrast (AA, 4.5:1)  light     dark      dark-hc",
      "  text/background     15.1 ✓    15.1 ✓    15.1 ✓",
      "  text/surface        17.3 ✓    12.2 ✓    12.2 ✓",
      "  muted/background    4.9 ✓     5.5 ✓     9.5 ✓",
      "  muted/surface       5.6 ✓     4.5 ✓     7.6 ✓",
      "  primary/background  6.0 ✓     10.1 ✓    10.1 ✓",
      "  danger/surface      5.4 ✓     7.6 ✓     7.6 ✓",
      "  on-primary/primary  6.8 ✓     8.1 ✓     8.1 ✓",
      "  on-danger/danger    5.4 ✓     7.6 ✓     7.6 ✓",
      "  on-success/success  5.1 ✓     8.4 ✓     8.4 ✓",
      "  on-warning/warning  6.3 ✓     9.4 ✓     9.4 ✓",
      "auto     on-primary, on-danger, on-success, on-warning · type h1–h3, caption, code · ramps moss-50…950, clay-50…950, stone-50…950 · space xs…3xl",
      "default  roles success, warning · border · opacity · levels raised, floating, modal · easings · layout · icons · focus ring · 7 components",
    ].join("\n"),
  );
});

test("a ramp keeps its color at the nearest step", () => {
  assert.equal(toHex(example.style!.palette.find((p) => p.name === "moss-600")!.color), "#4F7A3A");
  const steps = example.style!.palette.filter((p) => /^moss-\d+$/.test(p.name));
  assert.equal(steps.length, 11);
});

test("a ramp between two colors starts and ends on them", () => {
  const p = (n: string) => toHex(example.style!.palette.find((x) => x.name === n)!.color);
  assert.equal(p("stone-50"), "#F4F0E4");
  assert.equal(p("stone-950"), "#1E1A14");
});

test("a mode named with another's prefix starts from it", () => {
  // primary has no dark-hc value, so dark-hc takes dark's; muted has its own.
  assert.equal(hex("primary", "dark-hc"), hex("primary", "dark"));
  assert.notEqual(hex("muted", "dark-hc"), hex("muted", "dark"));
});

test("on- colors pick whichever of text and surface reads better, per mode", () => {
  const on = role("on-primary");
  assert.equal(on.from, "auto");
  assert.equal(hex("on-primary", "light"), hex("surface", "light"));
  assert.equal(hex("on-primary", "dark"), hex("surface", "dark"));
});

test("type sizes come from body and the ratio", () => {
  const sizes = Object.fromEntries(example.style!.type.map((t) => [t.name, t.size]));
  assert.deepEqual(sizes, { display: 48, h1: 31, h2: 25, h3: 20, body: 16, label: 16, caption: 13, code: 16 });
});

test("only the heading levels written exist, plus the ones above them", () => {
  const names = checkStyle(style("type", "  h2 24")).style!.type.map((t) => t.name);
  assert.deepEqual(names, ["display", "h1", "h2", "body", "label", "caption", "code"]);
});

test("space base= generates the size names", () => {
  assert.deepEqual(example.style!.space.values, { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 });
  assert.deepEqual(checkStyle(style("space base=4 lg=20")).style!.space.values.lg, 20);
});

test("an empty style is a complete grayscale default", () => {
  const r = checkStyle('style "Empty"');
  assert.deepEqual(r.issues, []);
  assert.equal(hex("primary", "light", r.style!), "#1A1A1A");
  assert.match(formatSummary(r.summary!), /^default  roles background, surface, text, muted, line, primary, danger, success, warning · body 16 · fonts Inter, JetBrains Mono/m);
});

test("defaults follow the page: a light surface in every mode keeps unwritten roles light", () => {
  const r = checkStyle(twoModes("color", "  surface #FFFFFF"));
  assert.deepEqual(r.issues, []);
  assert.equal(hex("text", "dark", r.style!), "#1A1A1A");
});

test("defaults follow the mode's name when the page isn't written", () => {
  const r = checkStyle(twoModes());
  assert.equal(hex("text", "dark", r.style!), "#F2F2F2");
});

test("the guidance lines are kept with their section", () => {
  const g = example.style!.guidance.map((x) => `${x.section} ${x.kind}`);
  assert.deepEqual(g, ["style about", "style dont", "style dont", "elevation about", "voice about", "voice dont", "voice do"]);
});

test("a level in a dark mode trades its shadow for tint", () => {
  const r = checkStyle(twoModes());
  const raised = r.style!.elevation.levels.find((l) => l.name === "raised")!;
  assert.equal(raised.modes.light.shadow.length, 1);
  assert.deepEqual([raised.modes.dark.shadow.length, raised.modes.dark.tint], [0, 4]);
});

test("a component without variants gets the catalog's", () => {
  const r = checkStyle(style("component button height=48"));
  assert.deepEqual(r.style!.components.find((c) => c.name === "button")!.variants.map((v) => v.name), ["filled", "plain"]);
});

test("guidance keeps its owner, and items keep their about=", () => {
  const s = checkStyle(
    style("radius sm=4", '  dont "Mixed corners."', "type", '  body 16 about="Long reads"', "palette", '  moss #4F7A3A about="From the logo"', "component button", '  dont "Two filled side by side."'),
  ).style!;
  assert.deepEqual(
    s.guidance.map((g) => [g.section, g.owner, g.kind]),
    [
      ["radius", undefined, "dont"],
      ["component", "button", "dont"],
    ],
  );
  assert.equal(s.type.find((t) => t.name === "body")!.about, "Long reads");
  assert.equal(s.palette.find((p) => p.name === "moss")!.about, "From the logo");
});
