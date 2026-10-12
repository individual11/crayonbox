/**
 * Color math with no dependencies: CSS color strings → sRGB, OKLab/OKLCH for ramps,
 * WCAG 2 contrast. Alpha is kept separately and composited before measuring contrast.
 */

/** sRGB channels 0–1 plus alpha 0–1. */
export type RGBA = { r: number; g: number; b: number; a: number };
type Lab = { L: number; a: number; b: number };

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** OKLab lightness each ramp step aims for (between Tailwind v4's neutral and chromatic ramps). */
const STEP_L = [0.975, 0.945, 0.89, 0.82, 0.72, 0.63, 0.54, 0.46, 0.38, 0.31, 0.22];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ---------------------------------------------------------------------------
// Parsing

const NUM = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;

/** "50%" → 0.5 of `scale`; "128" → 128 / `max` of `scale`. */
function channel(raw: string, max: number, scale = 1): number | undefined {
  const pct = raw.endsWith("%");
  const n = Number(pct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(n)) return undefined;
  return pct ? (n / 100) * scale : (n / max) * scale;
}

/** The comma- or space-separated arguments of a CSS function, and the alpha after "/" if any. */
function args(body: string): { parts: string[]; alpha?: string } | undefined {
  const [main, alpha, extra] = body.split("/").map((s) => s.trim());
  if (extra !== undefined) return undefined;
  const parts = main.split(/[\s,]+/).filter(Boolean);
  if (alpha === undefined && main.includes(",") && parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3] };
  return { parts, alpha };
}

function alphaOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return 1;
  const a = channel(raw, 1);
  return a === undefined || a < 0 || a > 1 ? undefined : a;
}

/**
 * A literal color: hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba(), hsl()/hsla()
 * or oklch(). Returns undefined for anything else.
 */
export function parseColor(text: string): RGBA | undefined {
  const t = text.trim().toLowerCase();
  if (t.startsWith("#")) {
    const h = t.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return undefined;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) : 1 };
  }
  const fn = t.match(/^([a-z]+)\((.*)\)$/);
  if (!fn) return undefined;
  const parsed = args(fn[2]);
  if (!parsed || parsed.parts.length !== 3 || !parsed.parts.every((p) => new RegExp(`^${NUM}%?(deg)?$`).test(p))) return undefined;
  const { parts } = parsed;
  const a = alphaOf(parsed.alpha);
  if (a === undefined) return undefined;
  switch (fn[1]) {
    case "rgb":
    case "rgba": {
      const [r, g, b] = parts.map((p) => channel(p, 255));
      if ([r, g, b].some((v) => v === undefined || v < 0 || v > 1)) return undefined;
      return { r: r!, g: g!, b: b!, a };
    }
    case "hsl":
    case "hsla": {
      const h = Number(parts[0].replace(/deg$/, ""));
      const s = channel(parts[1], 100);
      const l = channel(parts[2], 100);
      if (!Number.isFinite(h) || s === undefined || l === undefined || s < 0 || s > 1 || l < 0 || l > 1) return undefined;
      return { ...hslToRgb(h, s, l), a };
    }
    case "oklch": {
      const L = channel(parts[0], 1);
      const C = Number(parts[1].replace(/%$/, "")) * (parts[1].endsWith("%") ? 0.004 : 1);
      const H = Number(parts[2].replace(/deg$/, ""));
      if (L === undefined || L < 0 || L > 1 || !(C >= 0) || !Number.isFinite(H)) return undefined;
      return { ...clampToGamut(lchToLab({ L, C, H })), a };
    }
  }
  return undefined;
}

function hslToRgb(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

// ---------------------------------------------------------------------------
// sRGB ↔ OKLab (Björn Ottosson's matrices)

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToLab({ r, g, b }: { r: number; g: number; b: number }): Lab {
  const [R, G, B] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Linear-light sRGB, possibly out of gamut. */
function labToLinear({ L, a, b }: Lab) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

const inGamut = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].every((v) => v >= -1e-4 && v <= 1 + 1e-4);

const lchToLab = ({ L, C, H }: { L: number; C: number; H: number }): Lab => ({
  L,
  a: C * Math.cos((H * Math.PI) / 180),
  b: C * Math.sin((H * Math.PI) / 180),
});

const labToLch = ({ L, a, b }: Lab) => ({ L, C: Math.hypot(a, b), H: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 });

/** OKLab → sRGB, reducing chroma (keeping lightness and hue) until it fits. */
function clampToGamut(lab: Lab) {
  let lin = labToLinear(lab);
  if (!inGamut(lin)) {
    const { L, C, H } = labToLch(lab);
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinear(lchToLab({ L, C: mid, H })))) lo = mid;
      else hi = mid;
    }
    lin = labToLinear(lchToLab({ L, C: lo, H }));
  }
  return { r: clamp01(fromLinear(clamp01(lin.r))), g: clamp01(fromLinear(clamp01(lin.g))), b: clamp01(fromLinear(clamp01(lin.b))) };
}

// ---------------------------------------------------------------------------
// Ramps

/** Chroma a step can carry relative to the middle: less near white and black. */
const chromaRoom = (L: number) => Math.max(0.05, 1 - 0.85 * (2 * L - 1) ** 2);

/**
 * Eleven steps (50…950) around one color, in OKLCH: the color sits at the step whose
 * target lightness is closest, the others keep its hue and scale its chroma.
 */
export function rampAround(base: RGBA): { steps: RGBA[]; at: number } {
  const lch = labToLch(rgbToLab(base));
  let at = 0;
  STEP_L.forEach((L, i) => {
    if (Math.abs(L - lch.L) < Math.abs(STEP_L[at] - lch.L)) at = i;
  });
  const steps = STEP_L.map((L, i) => {
    if (i === at) return { ...base, a: 1 };
    const C = (lch.C * chromaRoom(L)) / chromaRoom(lch.L);
    return { ...clampToGamut(lchToLab({ L, C, H: lch.H })), a: 1 };
  });
  return { steps, at };
}

/** Eleven steps from `from` (50) to `to` (950), evenly in OKLab. */
export function rampBetween(from: RGBA, to: RGBA): RGBA[] {
  const a = rgbToLab(from);
  const b = rgbToLab(to);
  return STEPS.map((_, i) => {
    const t = i / (STEPS.length - 1);
    return { ...clampToGamut({ L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t }), a: 1 };
  });
}

// ---------------------------------------------------------------------------
// Contrast and output

/** `top` laid over `bottom` (alpha compositing in sRGB, as browsers do). */
export function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => (t * top.a + u * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

export const relativeLuminance = ({ r, g, b }: RGBA) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG 2 contrast ratio of `fg` over an opaque `bg`, 1–21. */
export function contrast(fg: RGBA, bg: RGBA): number {
  const solidBg = bg.a < 1 ? over(bg, { r: 1, g: 1, b: 1, a: 1 }) : bg;
  const f = relativeLuminance(over(fg, solidBg));
  const b = relativeLuminance(solidBg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}

/** #rrggbb, or #rrggbbaa when not opaque. */
export function toHex({ r, g, b, a }: RGBA): string {
  const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a) : ""}`.toUpperCase();
}

export const isDark = (c: RGBA) => relativeLuminance(c) < 0.18;
