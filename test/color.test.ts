import assert from "node:assert/strict";
import { test } from "node:test";
import { contrast, parseColor, rampAround, rampBetween, rgbToLab, toHex } from "../src/color.js";

const hex = (s: string) => toHex(parseColor(s)!);

test("hex forms", () => {
  assert.equal(hex("#abc"), "#AABBCC");
  assert.equal(hex("#4F7A3A"), "#4F7A3A");
  assert.equal(hex("#00000080"), "#00000080");
  assert.equal(parseColor("#12345"), undefined);
});

test("rgb, hsl and oklch", () => {
  assert.equal(hex("rgb(79 122 58)"), "#4F7A3A");
  assert.equal(hex("rgb(79, 122, 58)"), "#4F7A3A");
  assert.equal(hex("hsl(0 100% 50%)"), "#FF0000");
  assert.equal(hex("oklch(100% 0 0)"), "#FFFFFF");
  assert.equal(hex("oklch(0 0 0)"), "#000000");
  assert.equal(parseColor("oklch(55% 0.12 145 / 50%)")!.a, 0.5);
  assert.equal(parseColor("cornflowerblue"), undefined);
});

test("WCAG contrast", () => {
  assert.equal(Math.round(contrast(parseColor("#000")!, parseColor("#fff")!)), 21);
  assert.equal(contrast(parseColor("#777")!, parseColor("#777")!), 1);
});

test("ramps run light to dark", () => {
  const { steps, at } = rampAround(parseColor("#4F7A3A")!);
  assert.equal(steps.length, 11);
  assert.equal(toHex(steps[at]), "#4F7A3A");
  const L = steps.map((c) => rgbToLab(c).L);
  assert.ok(L.every((l, i) => i === 0 || l < L[i - 1]), L.join(", "));
  const between = rampBetween(parseColor("#fff")!, parseColor("#000")!);
  assert.deepEqual([toHex(between[0]), toHex(between[10])], ["#FFFFFF", "#000000"]);
});
