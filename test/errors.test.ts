/**
 * Error messages feed an LLM's repair loop, so they're part of the contract: each
 * rejection and warning names its line and says what to do, and nothing echoes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStyle } from "../src/check.js";
import { only, problems, style, twoModes } from "./helpers.js";

// Structure
test("a file starts with a style line", () => {
  assert.equal(only("color\n  text #111111"), `line 1: a style file starts with a style line, as in style "Field Notes" modes=light,dark`);
});

test("a typo for a section suggests it, and the lines under it don't echo", () => {
  assert.equal(only(style("colour", "  text #111111")), "line 2: \"colour\" isn't a section (did you mean color?)");
});

test("a section written twice", () => {
  assert.equal(only(style("color", "  text #111111", "color", "  muted #555555")), "line 4: color is already on line 2; put everything for color in one place");
});

test("a second style line", () => {
  assert.match(only(style('style "Other"')), /^line 2: a file has one style line .* a second brand is a second file$/);
});

test("a trailing comment", () => {
  assert.equal(only(style("color", "  text #111111 # ink")), 'line 3: comments go on their own line (starting with #); move "# ink" to the line above');
});

test("guidance takes one quoted sentence", () => {
  assert.equal(only(style("about plain words")), 'line 2: about takes one quoted sentence, as in about "Plain, warm, a little dry."');
});

test("a variant outside a component", () => {
  assert.equal(only(style("variant filled")), "line 2: variant lines go under a component line, as in component button");
});

test("a mode line where a mode value belongs on the item's line", () => {
  assert.equal(
    only(twoModes("color", "  surface #FFFFFF", "  dark #000000")),
    "line 4: dark is a mode; in color, give a mode's value on the item's own line, as in surface paper dark=stone-900",
  );
});

test("a mode name that collides with a property", () => {
  assert.equal(only('style "T" modes=light,fill'), "line 1: fill can't be a mode name: it's already a word crayonbox uses; pick another");
});

// Color
test("an unknown color name suggests close ones", () => {
  assert.equal(
    only(style("palette", "  moss #4F7A3A ramp", "color", "  primary mos-600")),
    "line 5: mos-600: mos-600 isn't a color name (did you mean moss-600, moss-100, moss-200?); define it in palette or color, or write hex",
  );
});

test("color words get their hex", () => {
  assert.equal(only(style("color", "  surface white")), "line 3: white: write #FFFFFF instead of white");
});

test("a malformed hex", () => {
  assert.equal(only(style("color", "  surface #12345")), "line 3: #12345 isn't a color; write hex (#4F7A3A), rgb(), hsl() or oklch()");
});

test("a palette color and a role can't share a name", () => {
  assert.equal(only(style("palette", "  primary #123456", "color", "  primary #654321")), "line 5: primary is already a palette color (line 3); every color name is used once");
});

test("an override that isn't a mode or a platform", () => {
  assert.equal(
    only(twoModes("color", "  surface #FFFFFF dim=#000000")),
    "line 3: dim= isn't a mode or a platform; modes are light, dark (add more with modes= on the style line)",
  );
});

test("roles that refer to each other in a loop", () => {
  assert.equal(only(style("color", "  text muted", "  muted text")), "line 3: text refers back to itself (text → muted → text)");
});

test("a near-miss role name is a warning", () => {
  assert.equal(only(style("color", "  primay #123456")), "line 3: warning: primay isn't a known role (did you mean primary?); extra roles are fine, but components only use the known ones");
});

test("alpha is a percentage", () => {
  assert.equal(only(style("color", "  line #000000/150")), "line 3: #000000/150: alpha after / is a percentage from 0 to 100, as in ink/60");
});

// Contrast
test("a failing pair suggests the nearest passing step", () => {
  assert.equal(
    only(style("palette", "  moss #4F7A3A ramp", "color", "  background #F4F0E4", "  primary moss-500")),
    "line 6: primary on background is 2.9:1; AA needs 4.5; try moss-700",
  );
});

test("a role with no value for a mode says it's the same in every mode", () => {
  assert.deepEqual(problems(twoModes("color", "  text #111111")), [
    "line 3: text on background is 1.0:1 in dark mode; AA needs 4.5; text has no dark= value, so it's #111111 in every mode",
    "line 3: text on surface is 1.1:1 in dark mode; AA needs 4.5; text has no dark= value, so it's #111111 in every mode",
  ]);
});

test("nothing reads on a fill", () => {
  assert.match(
    problems(style("color", "  primary #777777"))[1],
    /^line 3: nothing reads on primary: text is \d\.\d:1 and surface \d\.\d:1, AA needs 4\.5; make primary darker or lighter, or write on-primary$/,
  );
});

test("contrast=AAA raises the bar and names the rule", () => {
  const p = problems(style("color", "  muted #6B6B6B", "rule contrast=AAA"));
  assert.ok(p.includes("line 3: muted on background is 4.9:1; AAA needs 7 (rule on line 4)"), p.join("\n"));
});

// Type
test("a style name that isn't known points at headings", () => {
  assert.equal(only(style("type", "  title 32")), "line 3: warning: title isn't a known type style (headings are h1, h2, h3…); extra styles are fine, but components only use the known ones");
});

test("a generated size under min-text says where it came from", () => {
  assert.equal(only(style("type ratio=1.5", "  body 14")), "line 2: caption is 9, under the default min-text of 12 (caption works out to 9 from body ÷ 1.5; write caption 12 or raise body)");
});

test("past four heading levels is a warning", () => {
  assert.equal(only(style("type", "  h6 13")), "line 3: warning: h6: more than 4 heading levels are hard to tell apart; most products need three or four");
});

test("a font that doesn't exist", () => {
  assert.match(only(style("type font=serif")), /^line 2: font=serif: there's no font named serif; fonts are sans$/);
});

// Scales
test("unnamed space values", () => {
  assert.equal(only(style("space 4 8 12")), "line 2: space values have names so components can follow the scale; write space xs=4 sm=8 md=12 (or space base=4)");
});

test("a raw number off the scale names the nearest steps", () => {
  assert.equal(only(style("component button pad=0,14")), "line 2: warning: pad=14 isn't on the space scale; nearest: md (12), lg (16)");
});

test("a raw number on the scale asks for its name", () => {
  assert.equal(only(style("component button pad=0,16")), "line 2: warning: pad=16: write lg instead of 16, so it follows the space scale");
});

// Elevation, motion, layout, icons
test("flat with a shadow", () => {
  assert.equal(only(style("elevation flat", "  raised shadow=0,1,3,#000000/12")), "line 3: elevation flat means no shadows; remove shadow= from raised or drop flat");
});

test("a malformed shadow", () => {
  assert.equal(
    only(style("elevation", "  raised shadow=0,1,#000000")),
    "line 3: shadow=0,1,#000000: each layer is x,y,blur,color or x,y,blur,spread,color (layers join with +), as in shadow=0,1,3,ink/12",
  );
});

test("a mode line under a level", () => {
  assert.deepEqual(problems(twoModes("elevation", "  raised shadow=0,1,3,#000000/12", "    dark tint=4 shadow=none")), []);
});

test("a duration needs a unit", () => {
  assert.equal(only(style("motion fast=120")), "line 2: fast=120: a duration needs a unit, as in fast=120ms or fast=0.2s");
});

test("breakpoints go narrowest first", () => {
  assert.equal(
    only(style("layout", "  phone min=0", "  tablet min=700", "  desktop min=600")),
    "line 5: breakpoint desktop (min=600) must be wider than tablet (min=700); list them narrowest first",
  );
});

test("SF Symbols only as an iOS override", () => {
  assert.equal(
    only(style("icons sf-symbols")),
    "line 2: sf-symbols can't be drawn in the guide (its license limits use outside Apple platforms); write it as ios=sf-symbols after an open set, as in icons lucide ios=sf-symbols",
  );
  assert.deepEqual(problems(style("icons lucide ios=sf-symbols")), []);
});

// Components
test("a component outside the catalog", () => {
  assert.equal(only(style("component pricing")), "line 2: pricing isn't in the v0.1 catalog (button, input, card, badge, listitem, tabs, checkbox, radio, switch); custom components come later");
});

test("a variant named after a color", () => {
  assert.equal(only(style("component button", "  variant primary fill=primary")), "line 3: variant primary: name variants by how they look (filled, outlined, plain), not by color; primary is a color");
});

test("a size that changes color", () => {
  assert.equal(only(style("component button", "  size lg fill=primary height=48")), "line 3: size lg: sizes change dimensions only (height, pad, gap, type, icon, radius); put fill= on a variant");
});

test("a size under the touch target is a warning; the default size is an error", () => {
  assert.equal(only(style("component button", "  size sm height=32")), "line 3: warning: button size sm is 32 tall, under the 44 touch target; fine for pointer-only (web) layouts");
  assert.equal(only(style("component button height=40")), "line 2: button is 40 tall, under the 44 touch target; make it at least 44");
});

test("a variant's own colors are checked, without echoing a role pair", () => {
  assert.equal(
    only(style("component button", "  variant ghost fill=none text=#BBBBBB")),
    "line 3: button ghost: #BBBBBB on the background is 1.7:1; AA needs 4.5",
  );
});

// Rules
test("an unknown rule points at do lines", () => {
  assert.equal(
    only(style("rule links-underlined")),
    "line 2: links-underlined isn't a rule; rules are contrast, min-text, touch. Taste (where primary goes, how bold type gets) goes in about=, do or dont lines",
  );
});

test("a rule written twice", () => {
  assert.equal(only(style("rule contrast=AA", "rule contrast=AAA")), "line 3: rule contrast is already on line 2");
});

test("taste isn't a rule", () => {
  assert.match(only(style("rule primary-only=button")), /^line 2: primary-only isn't a rule; rules are contrast, min-text, touch\. Taste .* goes in about=, do or dont lines$/);
});

test("lowercase keywords are a warning, read correctly", () => {
  assert.equal(only(style("Color", "  text #111111")), "line 2: warning: write color in lowercase (read as color)");
});

test("checkStyle returns no summary when there are errors", () => {
  assert.equal(checkStyle(style("component pricing")).summary, undefined);
});
