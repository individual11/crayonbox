/**
 * Tidies a style file without changing what it means: sections in canonical order
 * (the guide's order), two spaces per level, keywords in lowercase, one blank line
 * between sections. Comments travel with the line below them; spacing inside a line
 * is kept, so aligned columns stay aligned.
 */
import { SECTIONS } from "./catalog.js";
import { Issues } from "./issues.js";
import { parseStyle } from "./parse.js";

type Group = { order: number; lines: string[] };

export function formatStyle(source: string): string {
  const file = parseStyle(source, new Issues());
  const raw = source.split("\n").map((l) => l.replace(/\r$/, "").replace(/\s+$/, ""));
  const { roles, blockOf, blocks } = file;

  // Indent per line; comments take the indent of the next statement below them.
  const indent = raw.map((_, i): number => {
    switch (roles[i]) {
      case "style":
      case "section":
        return 0;
      case "guidance":
      case "item":
        return 2;
      case "child": {
        const kind = blocks[blockOf[i]]?.kind;
        return kind === "component" || kind === "motion" ? 2 : 4;
      }
      default:
        return -1;
    }
  });
  for (let i = raw.length - 1, next = 0; i >= 0; i--) {
    if (roles[i] === "comment") indent[i] = next;
    else if (indent[i] >= 0) next = indent[i];
  }

  const text = (i: number) => {
    const t = raw[i].trim();
    if (roles[i] === "fence" || roles[i] === "unknown") return raw[i];
    const pad = " ".repeat(Math.max(0, indent[i]));
    if (roles[i] === "style" || roles[i] === "section" || roles[i] === "guidance") {
      const [head] = t.split(/\s/, 1);
      return pad + head.toLowerCase() + t.slice(head.length);
    }
    return pad + t;
  };

  // Split into the style part and one group per section; comments right above a
  // section header move with it.
  const groups: Group[] = [{ order: -2, lines: [] }];
  const fences: string[] = [];
  raw.forEach((_, i) => {
    if (roles[i] === "fence") return fences.push(raw[i]);
    if (roles[i] === "section" || roles[i] === "style") {
      const prev = groups.at(-1)!.lines;
      const carried: string[] = [];
      while (prev.length && prev.at(-1)!.trim().startsWith("#")) carried.unshift(prev.pop()!);
      const kind = roles[i] === "style" ? undefined : blocks[blockOf[i]].kind;
      groups.push({ order: kind ? SECTIONS.indexOf(kind) : -1, lines: [...carried, text(i)] });
      return;
    }
    if (roles[i] === "blank") {
      const g = groups.at(-1)!.lines;
      if (g.length && g.at(-1) !== "") g.push("");
      return;
    }
    groups.at(-1)!.lines.push(text(i));
  });

  const sorted = [...groups].sort((a, b) => a.order - b.order);
  const rule = SECTIONS.indexOf("rule");
  const out: string[] = [];
  let last: number | undefined;
  for (const g of sorted) {
    while (g.lines.at(-1) === "") g.lines.pop();
    while (g.lines[0] === "") g.lines.shift();
    if (!g.lines.length) continue;
    // Rule lines stay together; every other section gets a blank line before it.
    if (out.length && !(g.order === rule && last === rule && !g.lines[0].startsWith("#"))) out.push("");
    out.push(...g.lines);
    last = g.order;
  }
  const body = out.join("\n") + "\n";
  // A file wrapped in a code fence keeps its fences around the tidy body.
  return fences.length >= 2 ? `${fences[0]}\n${body}${fences.at(-1)}\n` : body;
}
