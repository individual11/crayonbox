import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStyle } from "../src/fmt.js";
import { read } from "./helpers.js";

test("the example is already tidy", () => {
  const text = read("examples/field-notes.crayon");
  assert.equal(formatStyle(text), text);
});

test("sections sort into the guide's order; comments travel with the line below", () => {
  const messy = ["rule contrast=AA", "# the brand", 'style "X"', "  ABOUT \"hi\"", "component button", "      variant filled fill=primary", "", "", "# colors first", "Color", "        text #111111", "rule touch=48"].join("\n");
  assert.equal(
    formatStyle(messy),
    ["# the brand", 'style "X"', '  about "hi"', "", "# colors first", "color", "  text #111111", "", "component button", "  variant filled fill=primary", "", "rule contrast=AA", "rule touch=48", ""].join("\n"),
  );
});

test("mode lines under a level indent one more step", () => {
  const text = ['style "X" modes=light,dark', "elevation", "raised shadow=0,1,3,#000000/12", "dark tint=4"].join("\n");
  assert.equal(formatStyle(text), ['style "X" modes=light,dark', "", "elevation", "  raised shadow=0,1,3,#000000/12", "    dark tint=4", ""].join("\n"));
});

test("aligned columns stay aligned", () => {
  const text = ['style "X"', "", "color", "  text    #111111", "  muted   #555555", ""].join("\n");
  assert.equal(formatStyle(text), text);
});

test("a fenced file keeps its fences", () => {
  assert.equal(formatStyle('```crayonbox\nstyle "X"\n```'), '```crayonbox\nstyle "X"\n```\n');
});
