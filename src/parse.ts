/**
 * Text → structure. One thing per line; the first word decides what a line is,
 * read in the context of the section above it. Indentation is for people: a line
 * belongs to the section (or item) above it whatever its indent. What the values
 * mean is checked in check.ts; this file only reports what it can see on one line.
 */
import {
  GUIDANCE,
  ITEM_SECTIONS,
  MODE_LINE_SECTIONS,
  PLATFORMS,
  REPEATABLE,
  RESERVED,
  SECTIONS,
  type GuidanceKind,
  type SectionKind,
} from "./catalog.js";
import { Issues } from "./issues.js";
import { didYouMean } from "./suggest.js";

export type Token =
  | { kind: "string"; value: string }
  | { kind: "setting"; key: string; value: string; quoted: boolean }
  | { kind: "word"; value: string };

export type Line = {
  line: number;
  /** The tokens after the first word. */
  args: Token[];
  /** Something on the line couldn't be read (already reported); skip follow-on checks. */
  broken?: boolean;
};

export type Guidance = { line: number; kind: GuidanceKind; text: string };
export type ChildKind = "mode" | "variant" | "size" | "state" | "ease";
export type Child = Line & { kind: ChildKind; name: string };
export type Item = Line & { name: string; children: Child[] };
export type Block = Line & {
  kind: SectionKind;
  items: Item[];
  children: Child[];
  guidance: Guidance[];
  /** A second copy of a section that may appear once (already reported); ignored by the checker. */
  duplicate?: boolean;
};

/** What each source line is, for `fmt`. */
export type Role = "blank" | "comment" | "fence" | "style" | "guidance" | "section" | "item" | "child" | "unknown";

export type StyleFile = {
  line: number;
  name?: string;
  modes: string[];
  /** Where each mode was declared (the style line). */
  guidance: Guidance[];
  blocks: Block[];
  roles: Role[];
  /** For each source line, the index of the block it belongs to (-1 = the style part). */
  blockOf: number[];
};

const WORD = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A line split into tokens: quoted strings, key=value settings (value optionally quoted)
 * and bare words. Parentheses group, so `oklch(55% 0.1 145)` is one word.
 */
export function tokenize(text: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = [];
  let i = 0;
  const quoted = (): string | null => {
    const end = text.indexOf('"', i + 1);
    if (end < 0) return null;
    const value = text.slice(i + 1, end);
    i = end + 1;
    return value;
  };
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (text[i] === '"') {
      const value = quoted();
      if (value === null) return { tokens, error: `unclosed quote: ${text.slice(i)}` };
      tokens.push({ kind: "string", value });
      continue;
    }
    const start = i;
    let depth = 0;
    while (i < text.length && (depth > 0 || !/[\s"]/.test(text[i]))) {
      if (text[i] === "(") depth++;
      if (text[i] === ")") depth = Math.max(0, depth - 1);
      i++;
    }
    if (depth > 0) return { tokens, error: `unclosed "(" in ${text.slice(start)}` };
    const word = text.slice(start, i);
    const eq = word.indexOf("=");
    if (eq > 0) {
      const key = word.slice(0, eq).toLowerCase();
      if (eq === word.length - 1 && text[i] === '"') {
        const value = quoted();
        if (value === null) return { tokens, error: `unclosed quote: ${text.slice(start)}` };
        tokens.push({ kind: "setting", key, value, quoted: true });
      } else tokens.push({ kind: "setting", key, value: word.slice(eq + 1), quoted: false });
    } else tokens.push({ kind: "word", value: word });
  }
  return { tokens };
}

const isSection = (w: string): w is SectionKind => (SECTIONS as readonly string[]).includes(w);
const isGuidance = (w: string): w is GuidanceKind => (GUIDANCE as readonly string[]).includes(w);

export function parseStyle(source: string, issues = new Issues()): StyleFile {
  const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
  const file: StyleFile = { line: 1, modes: ["light"], guidance: [], blocks: [], roles: [], blockOf: [] };
  let sawStyle = false;
  let reportedNoStyle = false;
  let tabsLine = 0;
  let block: Block | undefined;
  let swallowing = false;
  const firstOf = new Map<SectionKind, Block>();

  const addGuidance = (ln: number, kind: GuidanceKind, args: Token[]) => {
    const [first, ...rest] = args;
    if (!first || first.kind !== "string" || rest.length) {
      issues.error(ln, `${kind} takes one quoted sentence, as in ${kind} "Plain, warm, a little dry."`);
      return;
    }
    const g = { line: ln, kind, text: first.value };
    (block ? block.guidance : file.guidance).push(g);
  };

  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    const text = raw.trim();
    file.blockOf.push(block ? file.blocks.indexOf(block) : -1);
    if (!text) return file.roles.push("blank");
    if (text.startsWith("#")) return file.roles.push("comment");
    if (text.startsWith("```")) return file.roles.push("fence");
    if (/^\s*\t/.test(raw) && !tabsLine) tabsLine = ln;

    const { tokens, error } = tokenize(text);
    if (error) issues.error(ln, error);
    const [head, ...args] = tokens;
    let broken = !!error;
    const HEXISH = /^#[0-9a-f]{3,8}(\/[\d.]+)?$/i;
    const stray = args.find((t) => t.kind === "word" && t.value.startsWith("#") && !HEXISH.test(t.value));
    if (stray) {
      const at = [...text.matchAll(/(?<=\s)#\S*/g)].find((m) => !HEXISH.test(m[0]))?.index ?? 0;
      issues.error(ln, `comments go on their own line (starting with #); move "${text.slice(at)}" to the line above`);
      broken = true;
    }
    if (!head || head.kind !== "word") {
      issues.error(ln, `a line starts with a word (a section like color, or a name); this one starts with ${head?.kind === "string" ? "a quoted string" : `"${text.split(/\s/)[0]}"`}`);
      return file.roles.push("unknown");
    }
    const word = head.value.toLowerCase();
    if (word !== head.value && (isSection(word) || isGuidance(word) || word === "style")) {
      issues.warn(ln, `write ${word} in lowercase (read as ${word})`);
    }

    // The style line.
    if (word === "style") {
      if (sawStyle) {
        issues.error(ln, `a file has one style line (the first is on line ${file.line}); a second brand is a second file`);
        return file.roles.push("unknown");
      }
      sawStyle = true;
      file.line = ln;
      readStyleLine(file, ln, args, issues);
      block = undefined;
      return file.roles.push("style");
    }
    if (!sawStyle && !reportedNoStyle) {
      issues.error(ln, `a style file starts with a style line, as in style "Field Notes" modes=light,dark`);
      reportedNoStyle = true;
    }

    // Lines under a section that couldn't be read are skipped: it was already reported.
    if (swallowing && !isSection(word) && !isGuidance(word) && word !== "variant" && word !== "size" && word !== "ease") {
      return file.roles.push("unknown");
    }
    swallowing = false;

    if (isGuidance(word)) {
      addGuidance(ln, word, args);
      return file.roles.push("guidance");
    }

    // `state hover fill=…` under a component is one of its states; `state hover=8` is the section.
    const componentState = word === "state" && block?.kind === "component" && args[0]?.kind === "word";
    if (isSection(word) && !componentState) {
      const earlier = firstOf.get(word);
      block = { line: ln, kind: word, args, items: [], children: [], guidance: [], broken };
      if (earlier && !REPEATABLE.has(word)) {
        issues.error(ln, `${word} is already on line ${earlier.line}; put everything for ${word} in one place`);
        block.duplicate = true;
      }
      if (!earlier) firstOf.set(word, block);
      file.blocks.push(block);
      file.blockOf[idx] = file.blocks.length - 1;
      return file.roles.push("section");
    }

    // Lines that belong to a component or to motion.
    if (word === "variant" || word === "size" || componentState) {
      if (block?.kind !== "component") {
        issues.error(ln, `${word} lines go under a component line, as in component button`);
        return file.roles.push("unknown");
      }
      return addChild(block, word as ChildKind, ln, args, broken);
    }
    if (word === "ease") {
      if (block?.kind !== "motion") {
        issues.error(ln, `ease goes under the motion line, as in motion fast=120ms`);
        return file.roles.push("unknown");
      }
      return addChild(block, "ease", ln, args, broken);
    }

    // A mode line under an elevation level or a material.
    if (file.modes.includes(word) && block && ITEM_SECTIONS.has(block.kind)) {
      if (!MODE_LINE_SECTIONS.has(block.kind)) {
        issues.error(
          ln,
          `${word} is a mode; in ${block.kind}, give a mode's value on the item's own line, as in surface paper ${word}=stone-900`,
        );
        return file.roles.push("unknown");
      }
      const item = block.items.at(-1);
      if (!item) {
        issues.error(ln, `the ${word} line changes the item above it, but there's no ${block.kind} item yet`);
        return file.roles.push("unknown");
      }
      item.children.push({ line: ln, kind: "mode", name: word, args, broken });
      return file.roles.push("child");
    }

    if (block && ITEM_SECTIONS.has(block.kind)) {
      if (!WORD.test(head.value)) {
        issues.error(ln, `"${head.value}" can't name a ${block.kind} item; use lowercase letters, digits and dashes, as in moss or surface-raised`);
        return file.roles.push("unknown");
      }
      if (RESERVED.has(word)) {
        issues.error(ln, `${word} is a reserved word and can't name a ${block.kind} item; pick another name`);
        return file.roles.push("unknown");
      }
      block.items.push({ line: ln, name: head.value, args, children: [], broken });
      return file.roles.push("item");
    }

    const where = block ? `; ${block.kind} takes no lines below it except about, do and dont` : "";
    issues.error(ln, `"${head.value}" isn't a section${didYouMean(word, [...SECTIONS, ...GUIDANCE])}${where}`);
    if (!block) swallowing = true;
    return file.roles.push("unknown");

    function addChild(b: Block, kind: ChildKind, line: number, rest: Token[], isBroken: boolean) {
      const [name, ...more] = rest;
      if (kind === "ease") {
        b.children.push({ line, kind, name: "ease", args: rest, broken: isBroken });
        return file.roles.push("child");
      }
      if (!name || name.kind !== "word") {
        issues.error(line, `${kind} needs a name, as in ${kind === "variant" ? "variant filled fill=primary" : kind === "size" ? "size sm height=32" : "state disabled opacity=0.4"}`);
        return file.roles.push("unknown");
      }
      b.children.push({ line, kind, name: name.value, args: more, broken: isBroken });
      return file.roles.push("child");
    }
  });

  if (!sawStyle && !reportedNoStyle) issues.error(1, `a style file starts with a style line, as in style "Field Notes" modes=light,dark`);
  if (tabsLine) issues.warn(tabsLine, "tabs in indentation; use two spaces per level (read as written)");
  return file;
}

function readStyleLine(file: StyleFile, ln: number, args: Token[], issues: Issues) {
  for (const t of args) {
    if (t.kind === "string") {
      if (file.name !== undefined) issues.error(ln, `the style line takes one quoted name; "${t.value}" is a second one`);
      else file.name = t.value;
    } else if (t.kind === "setting" && t.key === "modes") {
      const modes = t.value.split(",").map((m) => m.trim());
      const bad = modes.find((m) => !WORD.test(m));
      if (!modes.length || bad !== undefined) {
        issues.error(ln, `modes is a comma-separated list of lowercase names, as in modes=light,dark,dark-hc${bad ? ` ("${bad}" isn't one)` : ""}`);
        continue;
      }
      const taken = modes.find((m) => RESERVED.has(m) || (PLATFORMS as readonly string[]).includes(m) || MODE_TAKEN.has(m));
      if (taken) {
        issues.error(ln, `${taken} can't be a mode name: it's already a word crayonbox uses; pick another`);
        continue;
      }
      const dup = modes.find((m, i) => modes.indexOf(m) !== i);
      if (dup) {
        issues.error(ln, `mode ${dup} is listed twice`);
        continue;
      }
      file.modes = modes;
    } else if (t.kind === "setting") {
      issues.error(ln, `the style line takes a quoted name and modes=; ${t.key}= isn't one of them${didYouMean(t.key, ["modes"])}`);
    } else {
      issues.error(ln, `the style line takes a quoted name and modes=, as in style "Field Notes" modes=light,dark; "${t.value}" isn't either`);
    }
  }
  if (file.name === undefined) issues.error(ln, `the style needs a quoted name, as in style "Field Notes"`);
}

/** Property keys, which a mode name would collide with in `name=value`. */
const MODE_TAKEN = new Set([
  "fill",
  "text",
  "line",
  "border",
  "radius",
  "pad",
  "height",
  "gap",
  "type",
  "icon",
  "elevation",
  "material",
  "opacity",
  "about",
  "font",
  "weight",
  "tracking",
  "features",
  "ratio",
  "fallback",
  "ramp",
  "from",
  "to",
  "base",
  "shadow",
  "tint",
  "blur",
  "min",
  "columns",
  "gutter",
  "margin",
  "max",
  "touch",
  "stroke",
  "sizes",
  "color",
  "width",
  "offset",
  "reduced",
]);
