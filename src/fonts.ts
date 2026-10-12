/**
 * Fonts for the guide. Inter (pinned, from @fontsource) draws the guide's own labels
 * and stands in for any font we can't get. A style's fonts are fetched from Google
 * Fonts by family name (a plain request gets TTF, which Satori reads; it can't read
 * WOFF2) and cached on disk. A font we can't fetch is drawn in Inter and labeled so.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import type { Style } from "./check.js";
import type { Platform } from "./catalog.js";

export type SatoriFont = { name: string; data: Buffer; weight: number; style: "normal" | "italic" };

/** How one of the style's fonts is drawn: its own face, or Inter standing in. */
export type FontUse = { family: string; drawAs: string; standIn: boolean; note?: string };

export type FontOptions = {
  /** Fetch Google Fonts by name (default true). */
  fetch?: boolean;
  /** Where fetched fonts are cached (default ~/.cache/crayonbox/fonts). */
  cacheDir?: string;
  platform?: Platform;
};

/** The guide's own face, and every stand-in. */
export const UI_FONT = "Inter";

const inter = (weight: number) => createRequire(import.meta.url).resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`);

let uiFonts: Promise<SatoriFont[]> | undefined;
function loadUiFonts(): Promise<SatoriFont[]> {
  uiFonts ??= Promise.all(
    [400, 500, 600, 700].map(async (weight) => ({ name: UI_FONT, data: await readFile(inter(weight)), weight, style: "normal" as const })),
  );
  return uiFonts;
}

const defaultCache = () => path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "crayonbox", "fonts");

type Face = { weight: number; style: "normal" | "italic"; url: string };

/** The faces Google Fonts serves for a family, or undefined if it doesn't know the family. */
async function googleFaces(family: string, weights: number[], italic: boolean): Promise<Face[] | undefined> {
  const axes = italic ? `ital,wght@${[...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(";")}` : `wght@${weights.join(";")}`;
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${axes}`;
  let res = await fetch(url);
  // A family without some of those weights (or no italic) is a 400; ask for whatever it has.
  if (!res.ok) res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}`);
  if (!res.ok) return undefined;
  const css = await res.text();
  const faces: Face[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
    const style = /font-style:\s*italic/.test(block) ? "italic" : "normal";
    const src = block.match(/url\(([^)]+)\)\s*format\('(truetype|opentype|woff)'\)/);
    if (src) faces.push({ weight, style, url: src[1] });
  }
  return faces.length ? faces : undefined;
}

async function cached(dir: string, key: string, url: string): Promise<Buffer> {
  const file = path.join(dir, key.replace(/[^a-z0-9.-]+/gi, "_"));
  try {
    return await readFile(file);
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font download failed (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    await writeFile(file, data);
    return data;
  }
}

/** Families we know aren't on Google Fonts, with how the guide should name them. */
const NOT_ON_GOOGLE: Record<string, string> = { system: "the system font", "sf pro": "SF Pro", "sf mono": "SF Mono", "new york": "New York", menlo: "Menlo", "helvetica neue": "Helvetica Neue" };

/**
 * Every face the guide needs: Inter for labels, plus each of the style's fonts in the
 * weights its type styles use. Returns the faces for Satori and how each style font
 * is drawn.
 */
export async function loadFonts(style: Style, opts: FontOptions = {}): Promise<{ fonts: SatoriFont[]; uses: Map<string, FontUse> }> {
  const fonts = [...(await loadUiFonts())];
  const uses = new Map<string, FontUse>();
  const dir = opts.cacheDir ?? defaultCache();
  for (const f of style.fonts) {
    const family = (opts.platform && f.platforms[opts.platform]) || f.family;
    const styles = style.type.filter((t) => t.font === f.name);
    const weights = [...new Set([400, 600, ...styles.map((t) => Math.round(t.weight / 100) * 100)])].sort((a, b) => a - b);
    const italic = styles.some((t) => t.italic);
    const standIn = (note: string): FontUse => ({ family, drawAs: UI_FONT, standIn: true, note });
    if (family.toLowerCase() === UI_FONT.toLowerCase()) {
      uses.set(f.name, { family, drawAs: UI_FONT, standIn: false });
      continue;
    }
    const known = NOT_ON_GOOGLE[family.toLowerCase()];
    if (known) {
      uses.set(f.name, standIn(`${known} isn't on Google Fonts; shown in Inter`));
      continue;
    }
    if (opts.fetch === false) {
      uses.set(f.name, standIn(`${family} not fetched; shown in Inter`));
      continue;
    }
    try {
      const faces = await googleFaces(family, weights, italic);
      if (!faces) {
        uses.set(f.name, standIn(`${family} isn't on Google Fonts; shown in Inter`));
        continue;
      }
      const name = `crayon-${f.name}`;
      for (const face of faces) {
        const data = await cached(dir, `${family}-${face.weight}-${face.style}.ttf`, face.url);
        fonts.push({ name, data, weight: face.weight, style: face.style });
      }
      uses.set(f.name, { family, drawAs: name, standIn: false });
    } catch {
      uses.set(f.name, standIn(`${family} couldn't be downloaded; shown in Inter`));
    }
  }
  return { fonts, uses };
}
