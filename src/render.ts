/**
 * The SVG style guide: one tall board drawn from a checked style, in the guide's
 * order. The guide's own labels are neutral (Inter, grays) so the style's colors,
 * fonts and shapes are the only things on the page that belong to it. Satori lays
 * it out and draws text as outlines, so the SVG looks the same anywhere.
 */
import satori from "satori";
import { icons } from "lucide";
import { COMPONENTS, KNOWN_ROLES, ROLE_ABOUT, type Platform } from "./catalog.js";
import { checkStyle, labelColor, type CheckResult, type Component, type Style, type Summary, type TypeStyle } from "./check.js";
import { contrast, over, parseColor, toHex, type RGBA } from "./color.js";
import { loadFonts, UI_FONT, type FontOptions, type FontUse } from "./fonts.js";
import { errorsIn, formatIssues, type Issue } from "./issues.js";

export type RenderOptions = FontOptions & { platform?: Platform; source?: string };

export class StyleError extends Error {
  constructor(public issues: Issue[]) {
    super(`The style has problems; fix them before rendering:\n${formatIssues(issues)}`);
  }
}

// ---------------------------------------------------------------------------
// Elements (Satori takes plain { type, props } objects; no React needed)

type El = { type: string; props: Record<string, unknown> };
type Child = El | string | null | undefined | false;
type Css = Record<string, string | number | undefined>;

/** Satori crashes on an undefined style value, so drop them. */
const tidy = (style: Css): Css => Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== null));
const clean = (children: Child[]) => children.flat().filter((c): c is El | string => c !== null && c !== undefined && c !== false);
const box = (style: Css, ...children: (Child | Child[])[]): El => ({ type: "div", props: { style: tidy({ display: "flex", ...style }), children: clean(children as Child[]) } });
const col = (style: Css, ...children: (Child | Child[])[]) => box({ flexDirection: "column", ...style }, ...children);
const row = (style: Css, ...children: (Child | Child[])[]) => box({ flexDirection: "row", ...style }, ...children);
const text = (style: Css, s: string): El => ({ type: "div", props: { style: tidy({ display: "flex", ...style }), children: s } });
const img = (svg: string, w: number, h: number): El => ({
  type: "img",
  props: { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, width: w, height: h, style: { width: w, height: h } },
});

// ---------------------------------------------------------------------------
// The guide's own look

const W = 1200;
const PAD = 64;
const C = W - PAD * 2;
const UI = { bg: "#FFFFFF", ink: "#1A1A1A", soft: "#6B6B6B", faint: "#A3A3A3", rule: "#E6E6E6", panel: "#F5F5F3" };
const ui = (size: number, weight = 400, color = UI.ink): Css => ({ fontFamily: UI_FONT, fontSize: size, fontWeight: weight, color, lineHeight: 1.4 });

const tag = (label: string) =>
  text({ ...ui(11, 500, UI.soft), backgroundColor: UI.panel, borderRadius: 4, padding: "2px 6px", lineHeight: 1.2, flexShrink: 0 }, label);
const provenance = (from: string, how?: string) => (from === "written" ? null : tag(how ? `${from} · ${how}` : from));

function iconSvg(name: string, size: number, color: string, stroke: number): string {
  const node = (icons as Record<string, [string, Record<string, string>][]>)[name];
  const body = (node ?? [])
    .map(([t, attrs]) => `<${t} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
const icon = (name: string, size: number, color: string, stroke = 2) => img(iconSvg(name, size, color, stroke), size, size);

// ---------------------------------------------------------------------------
// Colors from the style, per mode

const css = (c: RGBA | undefined) => (c ? `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${+c.a.toFixed(3)})` : "transparent");
const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };

class Paint {
  constructor(
    private style: Style,
    readonly mode: string,
  ) {}

  /** A color expression (name, literal, either with /alpha), or undefined for none. */
  color(expr: string | undefined): RGBA | undefined {
    if (!expr || expr === "none") return undefined;
    let base = expr;
    let alpha = 1;
    const slash = expr.lastIndexOf("/");
    if (slash > expr.lastIndexOf(")")) {
      alpha = Number(expr.slice(slash + 1)) / 100;
      base = expr.slice(0, slash);
    }
    const c =
      base.startsWith("#") || base.includes("(")
        ? parseColor(base)
        : (this.style.roles.find((r) => r.name === base)?.colors[this.mode] ?? this.style.palette.find((p) => p.name === base)?.color);
    return c ? { ...c, a: c.a * alpha } : undefined;
  }

  role = (name: string) => this.color(name) ?? WHITE;

  /** A fill: a color, a gradient's CSS, or transparent. */
  fill(expr: string | undefined): Css {
    const g = expr ? this.style.gradients.find((x) => x.name === expr.split("/")[0]) : undefined;
    if (g) {
      const stops = g.stops.map((s) => css(this.color(s))).join(", ");
      return { backgroundImage: g.kind === "linear" ? `linear-gradient(${g.angle}deg, ${stops})` : `radial-gradient(${stops})` };
    }
    return { backgroundColor: css(this.color(expr)) };
  }

  /** `top` at `percent`% over `bottom`, made opaque against this mode's page. */
  layer(top: RGBA, percent: number, bottom: RGBA): RGBA {
    const page = over(this.color("background") ?? WHITE, WHITE);
    return over({ ...top, a: percent / 100 }, over(bottom, page));
  }

  isGradient = (expr: string | undefined) => !!expr && this.style.gradients.some((g) => g.name === expr.split("/")[0]);
}

// ---------------------------------------------------------------------------
// Rendering

type Ctx = { style: Style; summary: Summary; uses: Map<string, FontUse>; platform?: Platform };

/** Check a style's text and draw its guide as SVG. Throws StyleError if the style has errors. */
export async function renderStyle(source: string, opts: RenderOptions = {}): Promise<string> {
  const result = checkStyle(source);
  return renderChecked(result, opts);
}

export async function renderChecked(result: CheckResult, opts: RenderOptions = {}): Promise<string> {
  const errors = errorsIn(result.issues);
  if (errors.length || !result.style || !result.summary) throw new StyleError(errors.length ? errors : result.issues);
  const style = result.style;
  const { fonts, uses } = await loadFonts(style, opts);
  const ctx: Ctx = { style, summary: result.summary, uses, platform: opts.platform };
  const board = col(
    { width: W, backgroundColor: UI.bg, padding: PAD, gap: 72 },
    cover(ctx),
    colorSection(ctx),
    typeSection(ctx),
    layoutSection(ctx),
    elevationSection(ctx),
    shapeSection(ctx),
    motionSection(ctx),
    iconSection(ctx),
    componentSection(ctx),
    voiceSection(ctx),
    footer(opts.source),
  );
  return satori(board as never, { width: W, fonts: fonts as never });
}

// ---------------------------------------------------------------------------
// Sections

/**
 * Guidance is drawn where it was written: under a family's own heading (radius, border…),
 * beside a component's row, or at the top of a section that is one family. These are the
 * families whose lines belong to the section as a whole.
 */
const SECTION_LEVEL: Record<string, string[]> = {
  "Elevation and materials": ["elevation"],
  Motion: ["motion"],
  Icons: ["icons"],
  Components: ["state", "focus"],
};

/** Guidance from these sections; with `owner`, only lines written under that component. */
function guidance(ctx: Ctx, kinds: string[], owner?: string) {
  const g = ctx.style.guidance.filter((x) => kinds.includes(x.section) && x.owner === owner);
  return { about: g.filter((x) => x.kind === "about").map((x) => x.text), dos: g.filter((x) => x.kind === "do").map((x) => x.text), donts: g.filter((x) => x.kind === "dont").map((x) => x.text) };
}

/** Do and don't lines side by side, in the section they belong to. */
function doDont(dos: string[], donts: string[], width = C): El | null {
  if (!dos.length && !donts.length) return null;
  const list = (title: string, iconName: string, lines: string[]) =>
    col(
      { flex: 1, gap: 8, padding: 20, backgroundColor: UI.panel, borderRadius: 8 },
      row({ gap: 8, alignItems: "center" }, icon(iconName, 16, UI.ink), text(ui(13, 600), title)),
      lines.map((l) => text(ui(14, 400, UI.ink), l)),
    );
  return row({ gap: 16, width }, dos.length ? list("Do", "Check", dos) : null, donts.length ? list("Don't", "X", donts) : null);
}

function section(ctx: Ctx, n: number, title: string, note: El | null, ...content: (Child | Child[])[]): El {
  const g = guidance(ctx, SECTION_LEVEL[title] ?? []);
  return col(
    { gap: 24, width: C },
    col(
      { gap: 8, borderTop: `1px solid ${UI.rule}`, paddingTop: 24 },
      row({ gap: 12, alignItems: "baseline" }, text(ui(13, 500, UI.faint), String(n).padStart(2, "0")), text(ui(28, 600), title), note),
      g.about.map((a) => text({ ...ui(16, 400, UI.soft), maxWidth: 760 }, a)),
    ),
    ...content,
    doDont(g.dos, g.donts),
  );
}

const label = (s: string) => text(ui(13, 600, UI.ink), s);
const sub = (s: string) => text(ui(12, 400, UI.soft), s);
/** An item's own about="…", in quotes under its name. */
const aboutLine = (s: string | undefined, color = UI.soft) => (s ? text(ui(12, 400, color), `“${s}”`) : null);

/** One family inside a section (Palette, Radius…): its heading, its own about lines, content, then its do and don't. */
function family(ctx: Ctx, title: string, kind: string, extra: Child, ...content: (Child | Child[])[]): El {
  const g = guidance(ctx, [kind]);
  return col(
    { gap: 12 },
    row({ gap: 8, alignItems: "center" }, text(ui(15, 600), title), extra),
    g.about.map((a) => text({ ...ui(14, 400, UI.soft), maxWidth: 760 }, a)),
    ...content,
    doDont(g.dos, g.donts),
  );
}

function cover(ctx: Ctx): El {
  const { style, summary } = ctx;
  const g = guidance(ctx, ["style"]);
  return col(
    { gap: 20 },
    text(ui(13, 500, UI.faint), "STYLE GUIDE"),
    text({ ...ui(56, 700), lineHeight: 1.05 }, style.name),
    g.about.map((a) => text({ ...ui(20, 400, UI.soft), maxWidth: 820, lineHeight: 1.5 }, a)),
    row(
      { gap: 8, alignItems: "center", flexWrap: "wrap" },
      text(ui(13, 500, UI.soft), style.modes.length > 1 ? "Modes" : "Mode"),
      style.modes.map((m, i) => tag(i === 0 ? `${m} (default)` : style.baseOf[m] && style.baseOf[m] !== style.modes[0] ? `${m} (from ${style.baseOf[m]})` : m)),
      ctx.platform ? tag(`drawn for ${ctx.platform}`) : null,
    ),
    text(ui(13, 400, UI.faint), summary.counts),
    doDont(g.dos, g.donts),
  );
}

// --- Color -----------------------------------------------------------------

function colorSection(ctx: Ctx): El {
  const { style, summary } = ctx;
  const ramps = new Map<string, typeof style.palette>();
  const singles: typeof style.palette = [];
  for (const p of style.palette) {
    const m = p.name.match(/^(.+)-(\d+)$/);
    if (p.ramp && m) ramps.set(m[1], [...(ramps.get(m[1]) ?? []), p]);
    else if (!style.palette.some((q) => q.ramp && q.name.startsWith(`${p.name}-`))) singles.push(p);
  }
  const ink = (c: RGBA) => (contrast({ r: 0, g: 0, b: 0, a: 1 }, over(c, WHITE)) > contrast(WHITE, over(c, WHITE)) ? "#000000" : "#FFFFFF");
  const rampRow = (name: string, steps: typeof style.palette) => {
    const base = style.palette.find((p) => p.name === name);
    const w = Math.floor((C - 120) / steps.length);
    return row(
      { alignItems: "stretch" },
      col({ width: 120, gap: 2, justifyContent: "center", paddingRight: 8 }, label(name), sub(steps[0].ramp ?? ""), aboutLine(base?.about)),
      steps.map((s) =>
        col(
          { width: w, height: 64, backgroundColor: css(s.color), padding: 6, justifyContent: "space-between" },
          text(ui(11, base && steps[0].ramp?.startsWith("around") && toHex(base.color) === toHex(s.color) ? 700 : 500, ink(s.color)), s.name.replace(/^.*-/, "")),
          text(ui(10, 400, ink(s.color)), toHex(s.color)),
        ),
      ),
    );
  };
  const palette = ramps.size || singles.length
    ? family(
        ctx,
        "Palette",
        "palette",
        null,
        [...ramps.entries()].map(([n, s]) => rampRow(n, s)),
        singles.length
          ? row({ gap: 12, flexWrap: "wrap" }, singles.map((p) => col({ width: 160, gap: 6 }, box({ height: 56, borderRadius: 6, backgroundColor: css(p.color), border: `1px solid ${UI.rule}` }), label(p.name), sub(toHex(p.color)), aboutLine(p.about))))
          : null,
      )
    : null;

  const ratioFor = (role: string, mode: string) => {
    const p = summary.pairs.find((x) => x.fg === role) ?? summary.pairs.find((x) => x.bg === role && x.fg.startsWith("on-"));
    if (!p || p.ratios[mode] === undefined) return null;
    const r = p.ratios[mode];
    const ok = r >= summary.required;
    return row({ gap: 4, alignItems: "center" }, icon(ok ? "Check" : "X", 12, ok ? UI.soft : "#C62828"), text(ui(11, 500, UI.soft), p.fg === role ? `${(Math.floor(r * 10) / 10).toFixed(1)} on ${p.bg}` : `labels ${(Math.floor(r * 10) / 10).toFixed(1)}`));
  };
  const modeW = Math.floor((C - 260) / style.modes.length);
  const rank = (n: string) => ((KNOWN_ROLES as readonly string[]).includes(n) ? (KNOWN_ROLES as readonly string[]).indexOf(n) : KNOWN_ROLES.length);
  const roles = style.roles.filter((r) => !r.name.startsWith("on-")).sort((a, b) => rank(a.name) - rank(b.name));
  const roleRows = col(
    { gap: 0 },
    row({ paddingBottom: 8 }, box({ width: 260 }), style.modes.map((m) => text({ ...ui(12, 600, UI.soft), width: modeW }, m))),
    roles.map((r) => {
      const on = style.roles.find((x) => x.name === `on-${r.name}`);
      return row(
        { borderTop: `1px solid ${UI.rule}`, paddingTop: 12, paddingBottom: 12, alignItems: "center" },
        col({ width: 260, gap: 4, paddingRight: 16 }, row({ gap: 8, alignItems: "center" }, label(r.name), provenance(r.from, r.how)), sub(r.about ?? ROLE_ABOUT[r.name] ?? ""), on ? sub(`labels on it: ${on.how === "per mode" ? "per mode" : on.how ?? "on-" + r.name} (${on.from})`) : null),
        style.modes.map((m) => {
          const c = r.colors[m];
          const onC = on?.colors[m];
          return col(
            { width: modeW, gap: 6, paddingRight: 12 },
            row(
              { height: 44, borderRadius: 6, backgroundColor: css(c), border: `1px solid ${UI.rule}`, alignItems: "center", paddingLeft: 12 },
              onC ? text(ui(14, 600, css(onC)), "Aa") : null,
            ),
            row({ gap: 8, alignItems: "center" }, text(ui(11, 500, UI.soft), c ? toHex(c) : "–"), ratioFor(r.name, m)),
          );
        }),
      );
    }),
  );
  const gradients = style.gradients.length
    ? family(
        ctx,
        "Gradients",
        "gradient",
        null,
        row(
          { gap: 16, flexWrap: "wrap" },
          style.gradients.map((g) =>
            col({ gap: 6, width: 240 }, row({ gap: 6 }, style.modes.map((m) => box({ flex: 1, height: 64, borderRadius: 6, border: `1px solid ${UI.rule}`, ...new Paint(style, m).fill(g.name) }))), label(g.name), sub(`${g.kind}${g.kind === "linear" ? ` ${g.angle}°` : ""} · ${g.stops.join(" → ")}`), aboutLine(g.about)),
          ),
        ),
      )
    : null;
  return section(ctx, 1, "Color", text(ui(13, 400, UI.faint), `contrast ${summary.level} (${summary.required}:1)`), palette, family(ctx, "Roles", "color", null, roleRows), gradients);
}

// --- Type ------------------------------------------------------------------

const SAMPLES: Record<string, string> = {
  display: "Field notes, 1928",
  body: "A style guide is a set of promises: these colors, these sizes, this rhythm, every time. The checker keeps them.",
  label: "Save entry",
  caption: "Updated 06:40 · overcast",
  code: "crayonbox check field-notes.crayon",
};

function fontCss(ctx: Ctx, t: TypeStyle): Css {
  const use = ctx.uses.get(t.font);
  return {
    fontFamily: use?.drawAs ?? UI_FONT,
    fontSize: t.size,
    fontWeight: t.weight,
    lineHeight: t.line_height,
    letterSpacing: t.tracking ? `${t.tracking}em` : undefined,
    textTransform: t.upper ? "uppercase" : undefined,
    fontStyle: t.italic ? "italic" : undefined,
  };
}

function typeSection(ctx: Ctx): El {
  const { style } = ctx;
  const fonts = row(
    { gap: 16, flexWrap: "wrap" },
    style.fonts.map((f) => {
      const use = ctx.uses.get(f.name);
      const plat = Object.entries(f.platforms).map(([p, v]) => `${p}: ${v}`);
      return col(
        { width: 336, gap: 6, padding: 20, backgroundColor: UI.panel, borderRadius: 8 },
        row({ gap: 8, alignItems: "center" }, label(f.name), provenance(f.from)),
        text({ fontFamily: use?.drawAs ?? UI_FONT, fontSize: 28, color: UI.ink }, f.family),
        sub([f.fallback.length ? `then ${f.fallback.join(", ")}` : "", ...plat].filter(Boolean).join(" · ") || " "),
        use?.note ? text(ui(11, 500, "#B26A00"), use.note) : null,
        aboutLine(f.about),
      );
    }),
  );
  const styles = col(
    { gap: 0 },
    style.type.map((t) => {
      const sample = SAMPLES[t.name] ?? (t.name.startsWith("h") ? `Heading level ${t.name.slice(1)}` : `The ${t.name} style`);
      return row(
        { borderTop: `1px solid ${UI.rule}`, paddingTop: 16, paddingBottom: 16, alignItems: "flex-start" },
        col(
          { width: 240, gap: 4, paddingRight: 16 },
          row({ gap: 8, alignItems: "center" }, label(t.name), provenance(t.from, t.from === "written" ? undefined : t.how)),
          sub(`${ctx.style.fonts.find((f) => f.name === t.font)?.family ?? t.font} · ${t.size}/${t.line_height} · ${t.weight}`),
          sub([t.tracking ? `tracking ${t.tracking}` : "", t.upper ? "uppercase" : "", t.italic ? "italic" : ""].filter(Boolean).join(" · ") || " "),
          t.from === "written" && t.how ? sub(`size: ${t.how}`) : null,
          aboutLine(t.about),
        ),
        text({ ...fontCss(ctx, t), color: UI.ink, width: C - 240 }, sample),
      );
    }),
  );
  return section(ctx, 2, "Type", null, family(ctx, "Fonts", "font", null, fonts), family(ctx, "Styles", "type", null, styles));
}

// --- Layout and space ------------------------------------------------------

function layoutSection(ctx: Ctx): El {
  const { style } = ctx;
  const L = style.layout;
  const frames = L.breakpoints.map((b) => ({ ...b, width: Math.max(b.min, b.name === "phone" || b.min === 0 ? 390 : b.min) }));
  const scale = Math.min(1, C / Math.max(...frames.map((f) => f.width)));
  const grids = col(
    { gap: 20 },
    frames.map((f) => {
      const w = f.width * scale;
      const inner = (f.width - 2 * f.margin) * scale;
      const colW = (inner - (f.columns - 1) * f.gutter * scale) / f.columns;
      return col(
        { gap: 6 },
        row({ gap: 8, alignItems: "baseline" }, label(f.name), sub(`from ${f.min}px · ${f.columns} columns · gutter ${f.gutter} · margin ${f.margin}`), aboutLine(f.about)),
        row(
          { width: w, height: 72, border: `1px solid ${UI.rule}`, borderRadius: 6, paddingLeft: f.margin * scale, paddingRight: f.margin * scale, gap: f.gutter * scale },
          Array.from({ length: f.columns }, () => box({ width: colW, height: 70, backgroundColor: "rgba(59, 130, 246, 0.12)" })),
        ),
      );
    }),
  );
  const spaceMax = Math.max(...Object.values(style.space.values), 1);
  const k = Math.min(3, 600 / spaceMax);
  const space = family(
    ctx,
    "Space",
    "space",
    provenance(style.space.from === "written" && style.space.generated ? "auto" : style.space.from, style.space.generated ? "from base" : undefined),
    Object.entries(style.space.values).map(([n, v]) =>
      row({ alignItems: "center", gap: 12 }, text({ ...ui(13, 600), width: 60 }, n), text({ ...ui(12, 400, UI.soft), width: 40 }, String(v)), box({ width: Math.max(1, v * k), height: 16, backgroundColor: "rgba(59, 130, 246, 0.35)", borderRadius: 2 })),
    ),
  );
  const touch = col(
    { gap: 8 },
    label("Touch target"),
    row(
      { gap: 16, alignItems: "center" },
      box({ width: L.touch, height: L.touch, border: `2px dashed ${UI.soft}`, borderRadius: 6 }),
      sub(`${L.touch} × ${L.touch} minimum (48 on Android unless written) · content at most ${L.max}px wide`),
    ),
  );
  return section(ctx, 3, "Layout and space", provenance(L.from), family(ctx, "Grid", "layout", null, grids, touch), space);
}

// --- Elevation and materials -----------------------------------------------

function elevationSection(ctx: Ctx): El {
  const { style } = ctx;
  const levelW = Math.floor((C - 48 - 32 * (style.elevation.levels.length - 1)) / style.elevation.levels.length);
  const panels = style.modes.map((m) => {
    const p = new Paint(style, m);
    const bg = p.role("background");
    return col(
      { gap: 12 },
      sub(m),
      row(
        { gap: 32, padding: 24, backgroundColor: css(bg), borderRadius: 10, border: `1px solid ${UI.rule}` },
        style.elevation.levels.map((l) => {
          const v = l.modes[m];
          const material = v.material ? style.materials.find((x) => x.name === v.material)?.modes[m] : undefined;
          const base = material ? p.color(material.fill) : p.color(v.fill);
          const fill = base ? p.layer(p.role("text"), v.tint, base) : undefined;
          const shadow = v.shadow.map((s) => `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${css(s.color)}`).join(", ");
          const line = p.color(v.line ?? material?.line);
          const describe = [v.shadow.length ? `shadow ${v.shadow.map((s) => `${s.x},${s.y},${s.blur}`).join(" + ")}` : "no shadow", v.tint ? `tint ${v.tint}` : "", line ? "line" : "", v.material ? `material ${v.material}` : ""].filter(Boolean).join(" · ");
          const fg = css(p.role("text"));
          return col(
            { width: levelW, height: 104, padding: 16, borderRadius: 8, backgroundColor: css(fill), boxShadow: shadow || undefined, border: line ? `1px solid ${css(line)}` : undefined, gap: 4 },
            row({ gap: 8, alignItems: "center" }, text(ui(14, 600, fg), l.name), l.from === "default" ? text(ui(10, 500, fg), "default") : null),
            text({ ...ui(11, 400, fg), opacity: 0.75 }, describe),
            aboutLine(l.about, fg),
          );
        }),
      ),
    );
  });
  const materials = style.materials.length
    ? family(
        ctx,
        "Materials",
        "material",
        null,
        row(
          { gap: 24, flexWrap: "wrap" },
          style.materials.flatMap((mat) =>
            style.modes.map((m) => {
              const p = new Paint(style, m);
              const v = mat.modes[m];
              const backdrop = [p.role("primary"), p.role("danger"), p.role("success")].map(css);
              const line = p.color(v.line);
              return col(
                { gap: 6 },
                box(
                  { width: 240, height: 140, backgroundImage: `linear-gradient(90deg, ${backdrop[0]} 0%, ${backdrop[0]} 33%, ${backdrop[1]} 33%, ${backdrop[1]} 66%, ${backdrop[2]} 66%)`, borderRadius: 8, alignItems: "center", justifyContent: "center" },
                  col(
                    { width: 180, height: 90, borderRadius: 10, backgroundImage: `linear-gradient(90deg, ${backdrop[0]}, ${backdrop[1]}, ${backdrop[2]})`, overflow: "hidden" },
                    box({ width: 180, height: 90, ...p.fill(v.fill), border: line ? `1px solid ${css(line)}` : undefined, borderRadius: 10 }),
                  ),
                ),
                row({ gap: 8 }, label(mat.name), sub(`${m} · blur ${v.blur} (drawn as a softened backdrop)`)),
                aboutLine(mat.about),
              );
            }),
          ),
        ),
      )
    : null;
  const note = style.elevation.flat ? text(ui(13, 400, UI.faint), "flat: no shadows; depth from tint and lines") : null;
  return section(ctx, 4, "Elevation and materials", note, panels, materials);
}

// --- Shape -----------------------------------------------------------------

function shapeSection(ctx: Ctx): El {
  const { style } = ctx;
  const radius = family(
    ctx,
    "Radius",
    "radius",
    provenance(style.radius.from),
    row(
      { gap: 20, flexWrap: "wrap" },
      Object.entries(style.radius.values).map(([n, v]) =>
        col({ gap: 6, alignItems: "flex-start" }, box({ width: 88, height: 88, borderRadius: Math.min(v, 44), border: `2px solid ${UI.ink}`, backgroundColor: UI.panel }), label(n), sub(v >= 9999 ? "fully round" : `${v}px`)),
      ),
    ),
  );
  const border = family(
    ctx,
    "Border",
    "border",
    provenance(style.border.from),
    Object.entries(style.border.values).map(([n, v]) => row({ gap: 12, alignItems: "center" }, text({ ...ui(13, 600), width: 90 }, n), box({ width: 200, height: Math.max(v, 0.5), backgroundColor: UI.ink }), sub(`${v}px`))),
  );
  const ink = new Paint(style, style.modes[0]).role("text");
  const opacity = family(
    ctx,
    "Opacity",
    "opacity",
    provenance(style.opacity.from),
    row(
      { gap: 20 },
      Object.entries(style.opacity.values).map(([n, v]) =>
        col(
          { gap: 6 },
          box({ width: 88, height: 56, backgroundImage: "linear-gradient(90deg, #FFFFFF 50%, #1A1A1A 50%)", borderRadius: 6, border: `1px solid ${UI.rule}`, alignItems: "center", justifyContent: "center" }, box({ width: 56, height: 32, borderRadius: 4, backgroundColor: css({ ...ink, a: v }) })),
          label(n),
          sub(String(v)),
        ),
      ),
    ),
  );
  return section(ctx, 5, "Shape", null, radius, border, opacity);
}

// --- Motion ----------------------------------------------------------------

/** An easing as a curve from (0,0) to (1,1); the box grows to fit curves that overshoot. */
function curve(e: [number, number, number, number], size: number): string {
  const [x1, y1, x2, y2] = e;
  const lo = Math.min(0, y1, y2);
  const hi = Math.max(1, y1, y2);
  const s = size - 8;
  const k = s / (hi - lo);
  const P = (x: number, y: number) => `${4 + x * s},${4 + (hi - y) * k}`;
  const box = `<rect x="4" y="${4 + (hi - 1) * k}" width="${s}" height="${k}" fill="none" stroke="${UI.rule}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${box}<line x1="${4}" y1="${4 + (hi - 0) * k}" x2="${4 + x1 * s}" y2="${4 + (hi - y1) * k}" stroke="${UI.faint}"/><line x1="${4 + s}" y1="${4 + (hi - 1) * k}" x2="${4 + x2 * s}" y2="${4 + (hi - y2) * k}" stroke="${UI.faint}"/><path d="M${P(0, 0)} C${P(x1, y1)} ${P(x2, y2)} ${P(1, 1)}" fill="none" stroke="${UI.ink}" stroke-width="2.5"/></svg>`;
}

function motionSection(ctx: Ctx): El {
  const m = ctx.style.motion;
  const maxMs = Math.max(...Object.values(m.durations), 1);
  return section(
    ctx,
    6,
    "Motion",
    provenance(m.from),
    row(
      { gap: 32 },
      Object.entries(m.easings).map(([n, e]) => col({ gap: 6 }, img(curve(e, 140), 140, 140), label(n), sub(e.join(", ")))),
    ),
    col(
      { gap: 8 },
      Object.entries(m.durations).map(([n, ms]) =>
        row({ gap: 12, alignItems: "center" }, text({ ...ui(13, 600), width: 80 }, n), text({ ...ui(12, 400, UI.soft), width: 60 }, `${ms}ms`), box({ width: (ms / maxMs) * 480, height: 12, borderRadius: 6, backgroundColor: UI.ink })),
      ),
    ),
    sub(m.reduced === "fade" ? "Reduced motion: cross-fade only" : "Reduced motion: no animation"),
  );
}

// --- Icons -----------------------------------------------------------------

const ICON_SAMPLE = ["House", "Search", "Bell", "User", "Settings", "Heart", "Star", "Plus", "Check", "X", "ChevronRight", "Calendar"];

function iconSection(ctx: Ctx): El {
  const s = ctx.style.icons;
  const set = (ctx.platform && s.platforms[ctx.platform]) || s.set;
  const drawn = set === "lucide" ? null : text(ui(12, 500, "#B26A00"), `${set} isn't bundled yet; shown in Lucide`);
  const notes = Object.entries(s.platforms).map(([p, v]) => `${p}: ${v}`);
  return section(
    ctx,
    7,
    "Icons",
    provenance(s.from),
    sub([`${s.set} · stroke ${s.stroke}`, ...notes].join(" · ")),
    drawn,
    s.sizes.map((size) => row({ gap: Math.max(12, size), alignItems: "center" }, text({ ...ui(12, 500, UI.soft), width: 40 }, String(size)), ICON_SAMPLE.map((n) => icon(n, size, UI.ink, s.stroke)))),
  );
}

// --- Components ------------------------------------------------------------

const ORDER = Object.keys(COMPONENTS);

type Look = { bg: Css; color: string; border?: string; shadow?: string; opacity?: number };

function componentSection(ctx: Ctx): El {
  const { style } = ctx;
  const showHover = !ctx.platform || ctx.platform === "web";
  const panels = style.modes.map((m, i) => {
    const p = new Paint(style, m);
    return col(
      { gap: 12 },
      sub(m),
      col(
        { gap: 28, padding: 28, backgroundColor: css(p.role("background")), borderRadius: 10, border: `1px solid ${UI.rule}` },
        // A component's own guidance is drawn once, beside it in the first mode.
        [...style.components].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name)).map((c) => componentRow(ctx, p, c, showHover, i === 0)),
      ),
    );
  });
  const s = style.states;
  return section(ctx, 8, "Components", null, sub(`State layers: hover ${s.hover}% · pressed ${s.pressed}% · selected ${s.selected}% · focus ring ${style.focus.color}, ${style.focus.width}px, offset ${style.focus.offset}${style.focus.from === "default" ? " (default)" : ""}`), panels);
}

const space = (style: Style, v: string | undefined) => (v === undefined ? 0 : (style.space.values[v] ?? Number(v)) || 0);
const radius = (style: Style, v: string | undefined) => (v === undefined ? 0 : Math.min(style.radius.values[v] ?? Number(v) ?? 0, 999));

function componentRow(ctx: Ctx, p: Paint, c: Component, showHover: boolean, withNotes: boolean): El {
  const { style } = ctx;
  const fg = css(p.role("text"));
  const head = col(
    { gap: 4, width: 140, paddingRight: 8 },
    row({ gap: 8, alignItems: "center" }, text(ui(13, 600, fg), c.name), c.from === "default" ? text(ui(10, 500, fg), "default") : null),
    withNotes ? aboutLine(c.props.about, fg) : null,
  );
  const g = guidance(ctx, ["component"], c.name);
  const notes =
    withNotes && (g.about.length || g.dos.length || g.donts.length)
      ? col(
          { gap: 6, paddingTop: 4 },
          g.about.map((a) => text(ui(12, 400, fg), a)),
          g.dos.map((d) => row({ gap: 6, alignItems: "center" }, icon("Check", 12, fg), text(ui(12, 400, fg), d))),
          g.donts.map((d) => row({ gap: 6, alignItems: "center" }, icon("X", 12, fg), text(ui(12, 400, fg), d))),
        )
      : null;
  const typeOf = (name: string | undefined) => style.type.find((t) => t.name === name) ?? style.type.find((t) => t.name === "body")!;
  const font = (props: Record<string, string>) => fontCss(ctx, typeOf(props.type));
  const states = ["default", ...(showHover ? ["hover"] : []), "pressed", "focus", "disabled"];
  const stateProps = (name: string) => c.states.find((s) => s.name === name)?.props ?? {};
  const disabledOpacity = (props: Record<string, string>) => {
    const v = props.opacity ?? stateProps("disabled").opacity ?? "disabled";
    return style.opacity.values[v] ?? Number(v);
  };
  const focusRing = (bg: RGBA) => `0 0 0 ${style.focus.offset}px ${css(bg)}, 0 0 0 ${style.focus.offset + style.focus.width}px ${css(p.color(style.focus.color))}`;

  /** How a filled control looks in a state: its own colors, then a state layer or override. */
  const look = (props: Record<string, string>, state: string): Look => {
    const merged = { ...props, ...stateProps(state) };
    const content = p.color(labelColor(props, stateProps(state))) ?? p.role("text");
    const fillC = p.color(merged.fill);
    const under = fillC ?? p.role("background");
    const layer = state === "hover" || state === "pressed" ? style.states[state] : 0;
    const bg: Css = stateProps(state).fill
      ? p.fill(stateProps(state).fill)
      : p.isGradient(merged.fill)
        ? p.fill(merged.fill)
        : layer
          ? { backgroundColor: css(p.layer(content, layer, under)) }
          : fillC
            ? p.fill(merged.fill)
            : { backgroundColor: "transparent" };
    const lineC = p.color(merged.line);
    const width = merged.border ? (style.border.values[merged.border] ?? Number(merged.border)) : 1;
    return {
      bg,
      color: css(content),
      border: lineC ? `${width}px solid ${css(lineC)}` : undefined,
      shadow: state === "focus" ? focusRing(p.role("background")) : undefined,
      opacity: state === "disabled" ? disabledOpacity(merged) : undefined,
    };
  };

  const control = (props: Record<string, string>, l: Look, label: string, extra: Css = {}) => {
    const [pv, ph] = (props.pad ?? "0").split(",");
    return row(
      {
        height: Number(props.height) || 40,
        paddingTop: space(style, pv),
        paddingBottom: space(style, pv),
        paddingLeft: space(style, ph ?? pv),
        paddingRight: space(style, ph ?? pv),
        borderRadius: radius(style, props.radius),
        alignItems: "center",
        justifyContent: "center",
        border: l.border,
        boxShadow: l.shadow,
        opacity: l.opacity,
        ...l.bg,
        ...extra,
      },
      text({ ...font(props), color: l.color, lineHeight: 1 }, label),
    );
  };
  const stateLabel = (s: string) => text({ ...ui(10, 500, fg), opacity: 0.6, width: 120 }, s === "hover" ? "hover (web)" : s);
  const grid = (rows: { name: string; about?: string; cells: El[] }[], header = true) =>
    col(
      { gap: 10 },
      header ? row({ gap: 12 }, box({ width: 100 }), states.map(stateLabel)) : null,
      rows.map((r) => row({ gap: 12, alignItems: "center" }, col({ width: 100, gap: 2 }, text({ ...ui(11, 500, fg), opacity: 0.8 }, r.name), withNotes ? aboutLine(r.about, fg) : null), r.cells.map((cell) => box({ width: 120 }, cell)))),
    );

  let body: El;
  switch (c.name) {
    case "button": {
      const rows = c.variants.map((v) => ({ name: v.name, about: v.props.about, cells: states.map((s) => control({ ...c.props, ...v.props }, look({ ...c.props, ...v.props }, s), "Button")) }));
      const first = c.variants[0];
      const sizes = c.sizes.length
        ? row({ gap: 12, alignItems: "center" }, text({ ...ui(11, 500, fg), width: 100, opacity: 0.8 }, "sizes"), [{ name: "default", props: {} }, ...c.sizes].map((s) => control({ ...c.props, ...first?.props, ...s.props }, look({ ...c.props, ...first?.props, ...s.props }, "default"), s.name === "default" ? "Button" : `Button ${s.name}`)))
        : null;
      body = col({ gap: 10 }, grid(rows), sizes);
      break;
    }
    case "input": {
      const field = (state: string) => {
        const props = { ...c.props, ...stateProps(state) };
        const l = look(props, state === "error" ? "default" : state);
        const err = state === "error";
        return col(
          { gap: 4, width: 190, opacity: l.opacity },
          text(ui(11, 500, fg), "Label"),
          row(
            { height: Number(props.height) || 40, paddingLeft: space(style, (props.pad ?? "0,md").split(",")[1]), borderRadius: radius(style, props.radius), alignItems: "center", border: err ? `2px solid ${css(p.role("danger"))}` : l.border, boxShadow: l.shadow, ...l.bg },
            text({ ...font(props), color: css(p.role("muted")) }, "Placeholder"),
          ),
          text(ui(11, 400, err ? css(p.role("danger")) : css(p.role("muted"))), err ? "That doesn't look right" : "Helper text"),
        );
      };
      body = row({ gap: 16, flexWrap: "wrap" }, ["default", "focus", "error", "disabled"].map((s) => col({ gap: 4 }, stateLabel(s), field(s))));
      break;
    }
    case "card": {
      const level = style.elevation.levels.find((l) => l.name === (c.props.elevation ?? "raised"));
      const v = level?.modes[p.mode];
      const base = p.color(v?.fill ?? "surface") ?? p.role("surface");
      const fill = p.layer(p.role("text"), v?.tint ?? 0, base);
      const line = p.color(v?.line);
      body = col(
        { width: 360, padding: space(style, c.props.pad), borderRadius: radius(style, c.props.radius), backgroundColor: css(fill), boxShadow: v?.shadow.map((s) => `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${css(s.color)}`).join(", ") || undefined, border: line ? `1px solid ${css(line)}` : undefined, gap: 6 },
        text({ ...fontCss(ctx, typeOf(style.type.some((t) => t.name === "h3") ? "h3" : "body")), color: css(p.role("text")) }, "Heron at the north pond"),
        text({ ...fontCss(ctx, typeOf("body")), color: css(p.role("muted")) }, "Standing still for twenty minutes."),
      );
      break;
    }
    case "badge": {
      const statuses = ["danger", "success", "warning"].map((r) => ({ name: r, props: { fill: r } }));
      body = row(
        { gap: 12, flexWrap: "wrap", alignItems: "center" },
        [...c.variants, ...statuses].map((v) => control({ ...c.props, ...v.props }, look({ ...c.props, ...v.props }, "default"), v.name)),
      );
      break;
    }
    case "listitem": {
      const item = (state: string) => {
        const base = p.role("surface");
        const bg = state === "selected" ? p.layer(p.role("primary"), style.states.selected, base) : state === "hover" ? p.layer(p.role("text"), style.states.hover, base) : base;
        return row(
          { width: 360, height: Number(c.props.height) || 56, paddingLeft: space(style, (c.props.pad ?? "0,lg").split(",")[1]), gap: space(style, c.props.gap), alignItems: "center", backgroundColor: css(bg), borderBottom: `1px solid ${css(p.role("line"))}` },
          icon("Star", 20, css(state === "selected" ? p.role("primary") : p.role("text"))),
          text({ ...font(c.props), color: css(p.role("text")) }, state === "selected" ? "Selected item" : state === "hover" ? "Hovered item (web)" : "List item"),
        );
      };
      body = col({ gap: 0, borderRadius: 8, overflow: "hidden" }, ["default", ...(showHover ? ["hover"] : []), "selected"].map(item));
      break;
    }
    case "tabs": {
      body = row(
        { gap: 4, borderBottom: `1px solid ${css(p.role("line"))}` },
        ["Today", "Map", "Species"].map((t, i) =>
          col(
            { height: Number(c.props.height) || 44, paddingLeft: space(style, (c.props.pad ?? "0,md").split(",")[1]), paddingRight: space(style, (c.props.pad ?? "0,md").split(",")[1]), justifyContent: "center", borderBottom: i === 0 ? `2px solid ${css(p.role("primary"))}` : "2px solid transparent" },
            text({ ...font(c.props), color: css(i === 0 ? p.role("primary") : p.role("muted")) }, t),
          ),
        ),
      );
      break;
    }
    default: {
      const on = p.role("primary");
      const size = Number(c.props.height) || 20;
      const r = c.name === "radio" ? size : radius(style, c.props.radius);
      const one = (checked: boolean, disabled = false) => {
        if (c.name === "switch") {
          return row(
            { width: size * 1.8, height: size, borderRadius: size, padding: 2, justifyContent: checked ? "flex-end" : "flex-start", backgroundColor: css(checked ? on : p.role("line")), opacity: disabled ? style.opacity.values.disabled ?? 0.4 : 1 },
            box({ width: size - 4, height: size - 4, borderRadius: size, backgroundColor: css(p.role("surface")) }),
          );
        }
        const mark = checked ? (c.name === "radio" ? box({ width: size / 2.5, height: size / 2.5, borderRadius: size, backgroundColor: css(on) }) : icon("Check", size - 6, css(p.color("on-primary") ?? WHITE), 3)) : null;
        return row(
          { width: size, height: size, borderRadius: r, alignItems: "center", justifyContent: "center", border: `2px solid ${css(checked ? on : p.role("muted"))}`, backgroundColor: css(checked && c.name === "checkbox" ? on : p.role("surface")), opacity: disabled ? style.opacity.values.disabled ?? 0.4 : 1 },
          mark,
        );
      };
      body = row({ gap: 24, alignItems: "center" }, [["off", one(false)], ["on", one(true)], ["on, disabled", one(true, true)]].map(([l, el]) => row({ gap: 8, alignItems: "center" }, el as El, text(ui(11, 500, fg), l as string))));
    }
  }
  return row({ gap: 12, alignItems: "flex-start" }, head, col({ gap: 8 }, body, notes));
}

// --- Voice and imagery, footer ----------------------------------------------

function voiceSection(ctx: Ctx): El | null {
  const parts = (["voice", "imagery"] as const).map((k) => ({ k, g: guidance(ctx, [k]) })).filter(({ g }) => g.about.length || g.dos.length || g.donts.length);
  if (!parts.length) return null;
  return col(
    { gap: 24, width: C },
    col({ gap: 8, borderTop: `1px solid ${UI.rule}`, paddingTop: 24 }, row({ gap: 12, alignItems: "baseline" }, text(ui(13, 500, UI.faint), "09"), text(ui(28, 600), "Voice and imagery"))),
    parts.map(({ k, g }) => col({ gap: 12 }, text(ui(15, 600), k === "voice" ? "Voice" : "Imagery"), g.about.map((a) => text({ ...ui(16, 400, UI.soft), maxWidth: 760 }, a)), doDont(g.dos, g.donts))),
  );
}

function footer(source?: string): El {
  return col(
    { gap: 4, borderTop: `1px solid ${UI.rule}`, paddingTop: 16 },
    text(ui(12, 400, UI.faint), `Drawn by crayonbox${source ? ` from ${source}` : ""}.`),
    text(ui(12, 400, UI.faint), "auto: worked out from values the file wrote · default: not written, filled in by crayonbox"),
  );
}

