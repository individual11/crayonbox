/**
 * Cross-line rules: names that must exist, modes, defaults and their provenance,
 * contrast in every mode, and the `rule` lines. Produces the resolved `Style` (what
 * the guide and the exports will draw from) and the summary `check` prints.
 */
import {
  BORDER_DEFAULTS,
  BREAKPOINT_DEFAULTS,
  BREAKPOINT_KEYS,
  COLOR_WORDS,
  COMPONENTS,
  COMPONENT_KEYS,
  CONTRAST_LEVELS,
  DEFAULT_FONT,
  DEFAULT_MONO,
  DEFAULT_ROLES,
  DURATION_DEFAULTS,
  EASING_DEFAULTS,
  FILL_ROLES,
  FOCUS_DEFAULTS,
  HEADING,
  ICON_DEFAULTS,
  ICON_SETS,
  KNOWN_ROLES,
  LAYOUT_DEFAULTS,
  LEVELS,
  LEVEL_DEFAULTS,
  LEVEL_KEYS,
  MATERIAL_KEYS,
  OPACITY_DEFAULTS,
  PLATFORMS,
  PLATFORM_ICON_SETS,
  RADIUS_DEFAULTS,
  RADIUS_WORDS,
  REDUCED,
  RULES,
  RULE_DEFAULTS,
  SIZE_KEYS,
  SPACE_BASE,
  SPACE_STEPS,
  STATES,
  STATE_LAYERS,
  STYLE_DEFAULTS,
  TYPE_DEFAULTS,
  TYPE_KEYS,
  TYPE_STYLES,
  TYPE_SWITCHES,
  type Platform,
  type SectionKind,
} from "./catalog.js";
import { STEPS, contrast, over, parseColor, rampAround, rampBetween, toHex, isDark, type RGBA } from "./color.js";
import { errorsIn, Issues, type Issue } from "./issues.js";
import { parseStyle, type Block, type Child, type Item, type StyleFile, type Token } from "./parse.js";
import { closeMatches, didYouMean } from "./suggest.js";

export type Provenance = "written" | "auto" | "default";

/** One color per mode, with where it came from. */
export type ModeColors = Record<string, RGBA>;
export type Role = { name: string; line?: number; from: Provenance; how?: string; colors: ModeColors; about?: string };
export type TypeStyle = {
  name: string;
  line?: number;
  from: Provenance;
  how?: string;
  font: string;
  size: number;
  weight: number;
  line_height: number;
  tracking: number;
  upper: boolean;
  italic: boolean;
  features?: string;
  about?: string;
};
export type Shadow = { x: number; y: number; blur: number; spread: number; color: RGBA };
export type Level = { name: string; line?: number; from: Provenance; about?: string; modes: Record<string, { fill?: string; material?: string; shadow: Shadow[]; line?: string; tint: number }> };
export type Component = {
  name: string;
  line?: number;
  from: Provenance;
  props: Record<string, string>;
  variants: { name: string; line?: number; props: Record<string, string> }[];
  sizes: { name: string; line: number; props: Record<string, string> }[];
  states: { name: string; line: number; props: Record<string, string> }[];
};

export type Style = {
  name: string;
  modes: string[];
  baseOf: Record<string, string | undefined>;
  palette: { name: string; line: number; color: RGBA; ramp?: string; about?: string }[];
  roles: Role[];
  gradients: { name: string; line: number; kind: "linear" | "radial"; angle: number; stops: string[]; about?: string }[];
  fonts: { name: string; line?: number; from: Provenance; family: string; fallback: string[]; platforms: Partial<Record<Platform, string>>; about?: string }[];
  type: TypeStyle[];
  space: Scale;
  radius: Scale;
  border: Scale;
  opacity: Scale;
  materials: { name: string; line: number; about?: string; modes: Record<string, { blur: number; fill?: string; line?: string }> }[];
  elevation: { flat: boolean; levels: Level[] };
  motion: { durations: Record<string, number>; easings: Record<string, [number, number, number, number]>; reduced: string; from: Provenance };
  layout: { max: number; touch: number; breakpoints: { name: string; min: number; columns: number; gutter: number; margin: number; about?: string }[]; from: Provenance };
  icons: { set: string; stroke: number; sizes: number[]; platforms: Partial<Record<Platform, string>>; from: Provenance };
  states: Record<string, number>;
  focus: { color: string; width: number; offset: number; from: Provenance };
  components: Component[];
  /** about/do/dont lines with the section they sit in and, under a component line, that component. */
  guidance: { section: SectionKind | "style"; owner?: string; kind: string; text: string; line: number }[];
  rules: { contrast: string; minText: number; touch: number };
};

export type Scale = { values: Record<string, number>; from: Provenance; generated?: boolean };

export type Pair = { fg: string; bg: string; ratios: Record<string, number>; pass: boolean };
export type Summary = { title: string; modes: string[]; counts: string; pairs: Pair[]; auto: string[]; defaulted: string[]; required: number; level: string };
export type CheckResult = { file: StyleFile; style?: Style; summary?: Summary; issues: Issue[] };

const NUMBER = /^-?(\d+(\.\d+)?|\.\d+)$/;
const num = (raw: string) => (NUMBER.test(raw) ? Number(raw) : undefined);
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const list = (xs: readonly string[]) => xs.join(", ");

export function checkStyle(source: string): CheckResult {
  const issues = new Issues();
  const file = parseStyle(source, issues);
  const checker = new Checker(file, issues);
  const style = checker.run();
  const errors = errorsIn(issues.list);
  return { file, style, summary: errors.length ? undefined : summarize(style, checker.pairList), issues: issues.list };
}

// ---------------------------------------------------------------------------

type ColorDef = {
  name: string;
  line: number;
  kind: "palette" | "step" | "role" | "gradient";
  /** Palette and steps: a fixed color. Roles: an expression per mode (base value + overrides). */
  fixed?: RGBA;
  value?: string;
  overrides?: Record<string, string>;
};

class Checker {
  private modes: string[];
  private baseOf: Record<string, string | undefined> = {};
  private blocks = new Map<SectionKind, Block>();
  private colors = new Map<string, ColorDef>();
  private resolving = new Set<string>();
  private memo = new Map<string, RGBA | undefined>();
  private failed = new Set<string>();
  private style!: Style;

  constructor(
    private file: StyleFile,
    private issues: Issues,
  ) {
    this.modes = file.modes;
    for (const m of this.modes) this.baseOf[m] = this.base(m);
    for (const b of file.blocks) if (!b.duplicate && !this.blocks.has(b.kind)) this.blocks.set(b.kind, b);
  }

  /** A mode named with another mode's prefix (dark-hc) starts from that mode; others from the default. */
  private base(m: string): string | undefined {
    const prefixes = this.modes.filter((p) => p !== m && m.startsWith(p + "-")).sort((a, b) => b.length - a.length);
    if (prefixes.length) return prefixes[0];
    return m === this.modes[0] ? undefined : this.modes[0];
  }

  private chain(m: string): string[] {
    const out: string[] = [];
    for (let at: string | undefined = m; at && !out.includes(at); at = this.baseOf[at]) out.push(at);
    return out;
  }

  private isDarkMode = (m: string) => this.chain(m).includes("dark");
  private lineOf = (kind: SectionKind) => this.blocks.get(kind)?.line ?? this.file.line;
  private modeWords = (m: string) => (this.modes.length > 1 ? ` in ${m} mode` : "");

  run(): Style {
    const file = this.file;
    this.style = {
      name: file.name ?? "",
      modes: this.modes,
      baseOf: this.baseOf,
      palette: [],
      roles: [],
      gradients: [],
      fonts: [],
      type: [],
      space: { values: {}, from: "default" },
      radius: { values: {}, from: "default" },
      border: { values: {}, from: "default" },
      opacity: { values: {}, from: "default" },
      materials: [],
      elevation: { flat: false, levels: [] },
      motion: { durations: {}, easings: {}, reduced: "fade", from: "default" },
      layout: { max: LAYOUT_DEFAULTS.max, touch: LAYOUT_DEFAULTS.touch, breakpoints: [], from: "default" },
      icons: { ...ICON_DEFAULTS, sizes: [...ICON_DEFAULTS.sizes], platforms: {}, from: "default" },
      states: { ...STATE_LAYERS },
      focus: { ...FOCUS_DEFAULTS, from: "default" },
      components: [],
      guidance: [],
      rules: { contrast: RULE_DEFAULTS.contrast, minText: RULE_DEFAULTS.minText, touch: LAYOUT_DEFAULTS.touch },
    };
    for (const g of file.guidance) this.style.guidance.push({ section: "style", kind: g.kind, text: g.text, line: g.line });
    for (const b of file.blocks) {
      const owner = b.kind === "component" && b.args[0]?.kind === "word" ? b.args[0].value : undefined;
      for (const g of b.guidance) this.style.guidance.push({ section: b.kind, owner, kind: g.kind, text: g.text, line: g.line });
    }

    this.readPalette();
    this.readRoles();
    this.readGradients();
    this.readFonts();
    this.readType();
    this.style.space = this.readScale("space");
    this.style.radius = this.readScale("radius");
    this.style.border = this.readScale("border");
    this.style.opacity = this.readScale("opacity");
    this.readMaterials();
    this.readElevation();
    this.readMotion();
    this.readLayout();
    this.readIcons();
    this.readStates();
    this.readFocus();
    this.readRules();
    this.readComponents();
    this.headerOnly("voice");
    this.headerOnly("imagery");

    this.checkContrast();
    this.checkTypeRules();
    this.checkTouch();
    return this.style;
  }

  // -------------------------------------------------------------------------
  // Shared readers

  /** Settings on a line as key → value, reporting keys that aren't allowed. Words come back separately. */
  private settings(line: number, args: Token[], allowed: readonly string[], what: string) {
    const out: Record<string, string> = {};
    const words: string[] = [];
    for (const t of args) {
      if (t.kind === "setting") {
        if (!allowed.includes(t.key)) {
          this.issues.error(line, `${what} takes ${list(allowed.filter((k) => k !== "about"))}; ${t.key}= isn't one of them${didYouMean(t.key, [...allowed])}`);
          continue;
        }
        if (t.key in out) this.issues.error(line, `${t.key}= is written twice`);
        out[t.key] = t.value;
      } else if (t.kind === "string") {
        words.push(`"${t.value}"`);
      } else words.push(t.value);
    }
    return { out, words };
  }

  private number(line: number, key: string, raw: string, min: number, max = Infinity): number | undefined {
    const n = num(raw);
    if (n === undefined || n < min || n > max) {
      const range = max === Infinity ? `${min} or more` : `${min} to ${max}`;
      this.issues.error(line, `${key}=${raw} should be a number, ${range}`);
      return undefined;
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // Color

  private define(def: ColorDef) {
    const earlier = this.colors.get(def.name);
    if (earlier) {
      const what = (k: ColorDef["kind"]) => (k === "step" ? "a ramp step" : k === "role" ? "a role" : k === "gradient" ? "a gradient" : "a palette color");
      this.issues.error(def.line, `${def.name} is already ${what(earlier.kind)} (line ${earlier.line}); every color name is used once`);
      return false;
    }
    this.colors.set(def.name, def);
    return true;
  }

  private readPalette() {
    const block = this.blocks.get("palette");
    if (!block) return;
    if (block.args.length) this.issues.error(block.line, "palette takes no settings; put each color on its own line below it, as in   paper #F4F0E4");
    for (const item of block.items) {
      if (item.broken) continue;
      const { out, words } = this.settings(item.line, item.args, ["from", "to", "about"], "a palette color");
      const isRamp = words.includes("ramp");
      const values = words.filter((w) => w !== "ramp");
      if (isRamp && (out.from || out.to)) {
        if (values.length) this.issues.error(item.line, `a ramp between two colors takes from= and to= only, as in ${item.name} ramp from=paper to=ink`);
        if (!out.from || !out.to) {
          this.issues.error(item.line, `a ramp between two colors needs both from= and to=, as in ${item.name} ramp from=paper to=ink`);
          continue;
        }
        const a = this.color(out.from, item.line, "", "from");
        const b = this.color(out.to, item.line, "", "to");
        if (!a || !b) continue;
        const steps = rampBetween(a, b);
        this.addRamp(item, steps, `between ${out.from} and ${out.to}`, false, out.about);
        continue;
      }
      if (values.length !== 1) {
        this.issues.error(item.line, `a palette color is a name and one color, as in ${item.name} #4F7A3A (add ramp for 50…950 steps)`);
        continue;
      }
      const c = this.color(values[0], item.line, "");
      if (!c) continue;
      if (!this.define({ name: item.name, line: item.line, kind: "palette", fixed: c })) continue;
      this.style.palette.push({ name: item.name, line: item.line, color: c, about: out.about });
      if (isRamp) {
        const { steps, at } = rampAround({ ...c, a: 1 });
        this.addRamp(item, steps, `around ${item.name} at ${STEPS[at]}`, true);
      }
    }
  }

  private addRamp(item: Item, steps: RGBA[], how: string, baseDefined = false, about?: string) {
    if (!baseDefined && !this.define({ name: item.name, line: item.line, kind: "palette", fixed: steps[5] })) return;
    if (!baseDefined) this.style.palette.push({ name: item.name, line: item.line, color: steps[5], ramp: how, about });
    steps.forEach((c, i) => {
      const name = `${item.name}-${STEPS[i]}`;
      if (this.define({ name, line: item.line, kind: "step", fixed: c })) this.style.palette.push({ name, line: item.line, color: c, ramp: how });
    });
  }

  private readRoles() {
    const block = this.blocks.get("color");
    if (block?.args.length) this.issues.error(block.line, "color takes no settings; put each role on its own line below it, as in   surface #FFFFFF dark=#1E1E1E");
    const written = new Map<string, Item>();
    for (const item of block?.items ?? []) {
      if (item.broken) continue;
      const allowed = [...this.modes, ...PLATFORMS, "about"];
      const overrides: Record<string, string> = {};
      const words: string[] = [];
      let about: string | undefined;
      for (const t of item.args) {
        if (t.kind === "setting") {
          if (t.key === "about") about = t.value;
          else if (this.modes.includes(t.key) || (PLATFORMS as readonly string[]).includes(t.key)) {
            if (t.key === this.modes[0]) this.issues.warn(item.line, `${t.key} is the default mode, so ${t.key}= is the role's value; write it first instead`);
            overrides[t.key] = t.value;
          } else
            this.issues.error(
              item.line,
              `${t.key}= isn't a mode or a platform${didYouMean(t.key, allowed)}; modes are ${list(this.modes)} (add more with modes= on the style line)`,
            );
        } else words.push(t.kind === "string" ? `"${t.value}"` : t.value);
      }
      if (words.length !== 1) {
        this.issues.error(item.line, `a role is a name and one color, as in ${item.name} moss-600 dark=moss-300${words.length ? ` (found ${words.join(" ")})` : ""}`);
        continue;
      }
      if (!(KNOWN_ROLES as readonly string[]).includes(item.name) && !item.name.startsWith("on-")) {
        const close = closeMatches(item.name, [...KNOWN_ROLES]);
        if (close.length) this.issues.warn(item.line, `${item.name} isn't a known role (did you mean ${close.join(", ")}?); extra roles are fine, but components only use the known ones`);
      }
      if (!this.define({ name: item.name, line: item.line, kind: "role", value: words[0], overrides })) continue;
      written.set(item.name, item);
      this.style.roles.push({ name: item.name, line: item.line, from: "written", colors: {}, about });
    }
    // Defaults for known roles nobody wrote (secondary exists only when written). They
    // follow the page: dark defaults in a mode whose written background (or surface) is
    // dark, else by the mode's name (dark, dark-hc…).
    const defaults: ColorDef[] = [];
    for (const name of KNOWN_ROLES) {
      if (written.has(name) || name === "secondary" || this.colors.has(name)) continue;
      const def: ColorDef = { name, line: 0, kind: "role", value: DEFAULT_ROLES.light[name], overrides: {} };
      for (const m of this.modes) if (this.isDarkMode(m)) def.overrides![m] = DEFAULT_ROLES.dark[name];
      this.colors.set(name, def);
      defaults.push(def);
      this.style.roles.push({ name, from: "default", colors: {} });
    }
    const page = ["background", "surface"].find((n) => written.has(n));
    if (page && defaults.length) {
      const dark: Record<string, boolean> = {};
      for (const m of this.modes) {
        const c = this.roleColor(page, m, written.get(page)!.line);
        dark[m] = c ? isDark(over(c, { r: 1, g: 1, b: 1, a: 1 })) : this.isDarkMode(m);
      }
      for (const def of defaults) {
        def.value = DEFAULT_ROLES[dark[this.modes[0]] ? "dark" : "light"][def.name];
        def.overrides = {};
        for (const m of this.modes.slice(1)) if (dark[m] !== dark[this.modes[0]]) def.overrides[m] = DEFAULT_ROLES[dark[m] ? "dark" : "light"][def.name];
      }
      this.memo.clear();
      this.failed.clear();
    }
    // Resolve every role in every mode.
    for (const role of this.style.roles) {
      for (const m of this.modes) {
        const c = this.roleColor(role.name, m, role.line ?? this.lineOf("color"));
        if (c) role.colors[m] = c;
      }
    }
    // Automatic on- colors: whichever of text or surface reads better on the fill, per mode.
    for (const fill of FILL_ROLES) {
      const role = this.style.roles.find((r) => r.name === fill);
      if (!role || this.colors.has(`on-${fill}`) || this.failed.has(fill)) continue;
      const on: Role = { name: `on-${fill}`, from: "auto", colors: {} };
      const picks = new Set<string>();
      for (const m of this.modes) {
        const bg = role.colors[m];
        const text = this.roleColor("text", m, 0);
        const surface = this.roleColor("surface", m, 0);
        if (!bg || !text || !surface) continue;
        const pick = contrast(text, bg) >= contrast(surface, bg) ? "text" : "surface";
        picks.add(pick);
        on.colors[m] = pick === "text" ? text : surface;
      }
      on.how = picks.size === 1 ? [...picks][0] : "per mode";
      this.colors.set(on.name, { name: on.name, line: role.line ?? 0, kind: "role", value: "auto", overrides: {} });
      this.memo.set(on.name, undefined);
      for (const m of this.modes) this.memo.set(`${on.name}@${m}`, on.colors[m]);
      this.style.roles.push(on);
    }
  }

  /** A role's color in a mode: its own override, then its base modes', then its value. */
  private roleColor(name: string, mode: string, line: number): RGBA | undefined {
    const key = `${name}@${mode}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const def = this.colors.get(name);
    if (!def) return undefined;
    if (def.kind !== "role") return def.fixed;
    if (this.resolving.has(key)) {
      this.issues.error(def.line || line, `${name} refers back to itself (${[...this.resolving].map((k) => k.split("@")[0]).join(" → ")} → ${name})`);
      this.failed.add(name);
      this.memo.set(key, undefined);
      return undefined;
    }
    this.resolving.add(key);
    const expr = this.chain(mode).map((m) => def.overrides?.[m]).find((v) => v !== undefined) ?? def.value!;
    const which = this.chain(mode).find((m) => def.overrides?.[m] !== undefined);
    const c = this.color(expr, def.line || line, mode, which ?? undefined);
    this.resolving.delete(key);
    if (!c) this.failed.add(name);
    this.memo.set(key, c);
    return c;
  }

  /**
   * A color expression: a literal (#hex, rgb(), hsl(), oklch()) or a color name, either
   * one optionally followed by /alpha (0–100). Reports and returns undefined when it can't.
   */
  private color(expr: string, line: number, mode: string, key?: string): RGBA | undefined {
    const at = key ? `${key}=${expr}` : expr;
    let base = expr;
    let alpha = 1;
    const slash = expr.lastIndexOf("/");
    if (slash > expr.lastIndexOf(")")) {
      const a = num(expr.slice(slash + 1));
      if (a === undefined || a < 0 || a > 100) {
        this.issues.error(line, `${at}: alpha after / is a percentage from 0 to 100, as in ink/60`);
        return undefined;
      }
      alpha = a / 100;
      base = expr.slice(0, slash);
    }
    let c: RGBA | undefined;
    if (base.startsWith("#") || base.includes("(")) {
      c = parseColor(base);
      if (!c) {
        this.issues.error(line, `${at} isn't a color; write hex (#4F7A3A), rgb(), hsl() or oklch()`);
        return undefined;
      }
    } else if (this.colors.has(base)) {
      c = this.colors.get(base)!.kind === "role" ? this.roleColor(base, mode || this.modes[0], line) : this.colors.get(base)!.fixed;
      if (!c) return undefined;
    } else if (base in COLOR_WORDS) {
      this.issues.error(line, `${at}: write ${COLOR_WORDS[base]} instead of ${base}`);
      return undefined;
    } else {
      const known = [...this.colors.keys()].filter((n) => !/-\d+$/.test(n) || n.startsWith(base.split("-")[0]));
      this.issues.error(line, `${at}: ${base} isn't a color name${didYouMean(base, known)}; define it in palette or color, or write hex`);
      return undefined;
    }
    return { ...c, a: c.a * alpha };
  }

  /** Whether a value names something in the color namespace (for checks that only need existence). */
  private colorRef(raw: string, line: number, key: string, allowNone: boolean): boolean {
    if (raw === "none") {
      if (!allowNone) this.issues.error(line, `${key}=none isn't allowed here; ${key}= needs a color`);
      return allowNone;
    }
    if (this.colors.get(raw.split("/")[0])?.kind === "gradient" && key === "fill") return true;
    return this.color(raw, line, this.modes[0], key) !== undefined;
  }

  private readGradients() {
    const block = this.blocks.get("gradient");
    if (!block) return;
    for (const item of block.items) {
      if (item.broken) continue;
      const { out: gOut, words } = this.settings(item.line, item.args, ["about"], "a gradient");
      const [kind, ...rest] = words;
      if (kind !== "linear" && kind !== "radial") {
        this.issues.error(item.line, `a gradient is linear or radial, then its stops, as in ${item.name} linear 180 surface,primary/20`);
        continue;
      }
      let angle = 180;
      if (kind === "linear" && rest.length === 2) {
        const a = this.number(item.line, "angle", rest.shift()!, 0, 360);
        if (a === undefined) continue;
        angle = a;
      }
      if (rest.length !== 1) {
        this.issues.error(item.line, `a gradient's stops are one comma-separated list, as in ${item.name} ${kind}${kind === "linear" ? " 180" : ""} surface,primary/20`);
        continue;
      }
      const stops = rest[0].split(",");
      if (stops.length < 2) {
        this.issues.error(item.line, `a gradient needs at least two stops, as in surface,primary/20`);
        continue;
      }
      if (!stops.every((s) => this.color(s, item.line, this.modes[0]))) continue;
      if (this.define({ name: item.name, line: item.line, kind: "gradient" })) this.style.gradients.push({ name: item.name, line: item.line, kind, angle, stops, about: gOut.about });
    }
  }

  // -------------------------------------------------------------------------
  // Type

  private readFonts() {
    const block = this.blocks.get("font");
    if (block?.args.length) this.issues.error(block.line, `font takes no settings; put each font on its own line below it, as in   serif "Source Serif 4" fallback=Georgia,serif`);
    for (const item of block?.items ?? []) {
      if (item.broken) continue;
      const { out, words } = this.settings(item.line, item.args, ["fallback", "about", ...PLATFORMS], "a font");
      if (words.length !== 1 || !words[0].startsWith('"')) {
        this.issues.error(item.line, `a font is a name and a quoted family, as in ${item.name} "Source Serif 4" fallback=Georgia,serif`);
        continue;
      }
      if (this.style.fonts.some((f) => f.name === item.name)) {
        this.issues.error(item.line, `font ${item.name} is already defined`);
        continue;
      }
      const platforms: Partial<Record<Platform, string>> = {};
      for (const p of PLATFORMS) if (out[p]) platforms[p] = out[p];
      this.style.fonts.push({
        name: item.name,
        line: item.line,
        from: "written",
        family: words[0].slice(1, -1),
        fallback: out.fallback ? out.fallback.split(",") : [],
        platforms,
        about: out.about,
      });
    }
    if (!this.style.fonts.length) this.style.fonts.push({ ...DEFAULT_FONT, fallback: [...DEFAULT_FONT.fallback], from: "default", platforms: {} });
  }

  private fontRef(raw: string, line: number): boolean {
    if (this.style.fonts.some((f) => f.name === raw)) return true;
    this.issues.error(line, `font=${raw}: there's no font named ${raw}${didYouMean(raw, this.style.fonts.map((f) => f.name))}; fonts are ${list(this.style.fonts.map((f) => f.name))}`);
    return false;
  }

  private readType() {
    const block = this.blocks.get("type");
    const head = block ? this.settings(block.line, block.args, ["font", "ratio"], "the type line") : { out: {} as Record<string, string>, words: [] as string[] };
    if (block && head.words.length) this.issues.error(block.line, `the type line takes font= and ratio=, as in type font=serif ratio=1.25`);
    let ratio = TYPE_DEFAULTS.ratio;
    if ("ratio" in head.out) ratio = this.number(block!.line, "ratio", head.out.ratio, 1.01, 3) ?? ratio;
    let font = this.style.fonts[0].name;
    if ("font" in head.out && this.fontRef(head.out.font, block!.line)) font = head.out.font;

    type Written = { item: Item; size?: number; props: Record<string, string>; upper: boolean; italic: boolean };
    const written = new Map<string, Written>();
    for (const item of block?.items ?? []) {
      if (item.broken) continue;
      if (written.has(item.name)) {
        this.issues.error(item.line, `type style ${item.name} is already on line ${written.get(item.name)!.item.line}`);
        continue;
      }
      const { out, words } = this.settings(item.line, item.args, TYPE_KEYS, "a type style");
      let size: number | undefined;
      let ok = true;
      const sw = { upper: false, italic: false };
      for (const w of words) {
        if ((TYPE_SWITCHES as readonly string[]).includes(w)) sw[w as "upper" | "italic"] = true;
        else if (num(w) !== undefined && size === undefined) size = this.number(item.line, "size", w, 1, 400);
        else {
          this.issues.error(item.line, `${w} isn't something a type style takes; write a size, ${list(TYPE_KEYS.filter((k) => k !== "about").map((k) => k + "="))}, upper or italic${didYouMean(w, [...TYPE_SWITCHES])}`);
          ok = false;
        }
      }
      if (!ok) continue;
      const known = (TYPE_STYLES as readonly string[]).includes(item.name) || HEADING.test(item.name);
      if (!known) {
        const hint = ["title", "heading", "subtitle", "headline", "subheading"].includes(item.name) ? "headings are h1, h2, h3…" : `known styles are ${list(TYPE_STYLES)} and h1, h2, h3…`;
        this.issues.warn(item.line, `${item.name} isn't a known type style (${hint}); extra styles are fine, but components only use the known ones`);
      }
      if (out.font !== undefined && !this.fontRef(out.font, item.line)) continue;
      written.set(item.name, { item, size, props: out, ...sw });
    }

    const body = written.get("body")?.size ?? TYPE_DEFAULTS.body;
    const levels = [...written.keys()].map((n) => n.match(HEADING)).filter(Boolean).map((m) => Number(m![1]));
    const deepest = levels.length ? Math.max(...levels) : TYPE_DEFAULTS.headings;
    if (deepest > TYPE_DEFAULTS.warnPastHeading) {
      const ln = written.get(`h${deepest}`)!.item.line;
      this.issues.warn(ln, `h${deepest}: more than ${TYPE_DEFAULTS.warnPastHeading} heading levels are hard to tell apart; most products need three or four`);
    }
    const sizeFor = (name: string): { size: number; how: string } => {
      const step = (n: number) => Math.round(body * ratio ** n);
      const h = name.match(HEADING);
      if (h) {
        const n = deepest - Number(h[1]) + 1;
        return { size: step(n), how: `body × ${fmt(ratio)}${n > 1 ? sup(n) : ""}` };
      }
      if (name === "display") {
        const top = written.get("h1")?.size ?? step(deepest);
        return { size: Math.round(top * ratio ** 2), how: `h1 × ${fmt(ratio)}²` };
      }
      if (name === "caption") return { size: Math.round(body / ratio), how: `body ÷ ${fmt(ratio)}` };
      return { size: body, how: "body size" };
    };
    const mono = this.style.fonts.find((f) => f.name === "mono" || f.fallback.includes("monospace"));
    const names = ["display", ...Array.from({ length: deepest }, (_, i) => `h${i + 1}`), "body", "label", "caption", "code", ...written.keys()];
    for (const name of new Set(names)) {
      const w = written.get(name);
      const kind = HEADING.test(name) ? "heading" : name in STYLE_DEFAULTS ? name : "other";
      const d = STYLE_DEFAULTS[kind];
      let styleFont = w?.props.font ?? font;
      let how: string | undefined;
      if (name === "code" && !w?.props.font) {
        if (!mono) {
          this.style.fonts.push({ ...DEFAULT_MONO, fallback: [...DEFAULT_MONO.fallback], from: "default", platforms: {} });
          styleFont = DEFAULT_MONO.name;
        } else styleFont = mono.name;
      }
      let size = w?.size;
      if (size === undefined) ({ size, how } = sizeFor(name));
      const p = w?.props ?? {};
      const ln = w?.item.line ?? block?.line;
      this.style.type.push({
        name,
        line: w?.item.line,
        from: w ? "written" : name === "body" ? "default" : "auto",
        how: w ? (w.size === undefined ? how : undefined) : how,
        font: styleFont,
        size,
        weight: (p.weight !== undefined ? this.number(ln!, "weight", p.weight, 1, 1000) : undefined) ?? d.weight,
        line_height: (p.line !== undefined ? this.number(ln!, "line", p.line, 0.5, 4) : undefined) ?? d.line,
        tracking: (p.tracking !== undefined ? this.number(ln!, "tracking", p.tracking, -0.5, 1) : undefined) ?? 0,
        upper: !!w?.upper,
        italic: !!w?.italic,
        features: p.features,
        about: p.about,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scales

  private readScale(kind: "space" | "radius" | "border" | "opacity"): Scale {
    const block = this.blocks.get(kind);
    const defaults =
      kind === "space"
        ? Object.fromEntries(SPACE_STEPS.map(([n, k]) => [n, k * SPACE_BASE]))
        : kind === "radius"
          ? RADIUS_DEFAULTS
          : kind === "border"
            ? BORDER_DEFAULTS
            : OPACITY_DEFAULTS;
    if (!block) return { values: { ...defaults }, from: "default" };
    const max = kind === "opacity" ? 1 : Infinity;
    const example = { space: "space xs=4 sm=8 md=12", radius: "radius sm=2 md=4 full", border: "border hairline=1 strong=2", opacity: "opacity disabled=0.4 scrim=0.5" }[kind];
    const values: Record<string, number> = {};
    const named = new Set<string>();
    let generated = false;
    const set = (line: number, name: string, raw: string) => {
      if (named.has(name)) this.issues.error(line, `${kind} ${name} is written twice`);
      named.add(name);
      const n = this.number(line, name, raw, 0, max);
      if (n !== undefined) values[name] = n;
    };
    for (const t of block.args) {
      if (t.kind === "setting") {
        if (kind === "space" && t.key === "base") {
          const base = this.number(block.line, "base", t.value, 1, 64);
          if (base !== undefined) for (const [n, k] of SPACE_STEPS) values[n] ??= k * base;
          generated = true;
        } else set(block.line, t.key, t.value);
      } else if (t.kind === "word" && kind === "radius" && t.value in RADIUS_WORDS) values[t.value] = RADIUS_WORDS[t.value];
      else if (t.kind === "word" && num(t.value) !== undefined)
        this.issues.error(block.line, `${kind} values have names so components can follow the scale; write ${example}${kind === "space" ? " (or space base=4)" : ""}`);
      else this.issues.error(block.line, `${kind} takes name=value pairs, as in ${example}; "${t.kind === "string" ? t.value : t.value}" isn't one`);
    }
    // Written names win over generated ones, wherever they appear on the line.
    if (generated) for (const t of block.args) if (t.kind === "setting" && t.key !== "base" && num(t.value) !== undefined) values[t.key] = Number(t.value);
    for (const item of block.items) {
      if (item.broken) continue;
      const [v, ...rest] = item.args;
      if (!v || v.kind !== "word" || rest.some((r) => r.kind !== "setting" || r.key !== "about")) {
        this.issues.error(item.line, `a ${kind} line is a name and a number, as in ${item.name} 8`);
        continue;
      }
      set(item.line, item.name, v.value);
    }
    if (!Object.keys(values).length) return { values: { ...defaults }, from: "default" };
    return { values, from: "written", generated };
  }

  /** A scale name, or a raw number (allowed with a warning that names the nearest steps). */
  private scaleRef(scale: Scale, kind: string, raw: string, line: number, key: string): number | undefined {
    if (raw in scale.values) return scale.values[raw];
    const n = num(raw);
    if (n === undefined) {
      this.issues.error(line, `${key}=${raw}: ${raw} isn't on the ${kind} scale${didYouMean(raw, Object.keys(scale.values))}; ${kind} has ${list(Object.keys(scale.values))}`);
      return undefined;
    }
    if (n === 0) return 0;
    const same = Object.entries(scale.values).find(([, v]) => v === n);
    if (same) this.issues.warn(line, `${key}=${raw}: write ${same[0]} instead of ${raw}, so it follows the ${kind} scale`);
    else {
      const sorted = Object.entries(scale.values).sort((a, b) => Math.abs(a[1] - n) - Math.abs(b[1] - n)).slice(0, 2);
      this.issues.warn(line, `${key}=${raw} isn't on the ${kind} scale; nearest: ${sorted.map(([k, v]) => `${k} (${v})`).join(", ")}`);
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // Elevation and materials

  private shadow(raw: string, line: number, mode: string): Shadow[] | undefined {
    if (raw === "none") return [];
    const layers: Shadow[] = [];
    for (const layer of raw.split("+")) {
      const parts = layer.split(",");
      if (parts.length !== 4 && parts.length !== 5) {
        this.issues.error(line, `shadow=${raw}: each layer is x,y,blur,color or x,y,blur,spread,color (layers join with +), as in shadow=0,1,3,ink/12`);
        return undefined;
      }
      const nums = parts.slice(0, -1).map((p) => num(p));
      if (nums.some((n) => n === undefined)) {
        this.issues.error(line, `shadow=${raw}: x, y, blur and spread are numbers, as in shadow=0,1,3,ink/12`);
        return undefined;
      }
      const color = this.color(parts.at(-1)!, line, mode, "shadow");
      if (!color) return undefined;
      const [x, y, blur, spread = 0] = nums as number[];
      if (blur < 0) {
        this.issues.error(line, `shadow=${raw}: blur can't be negative`);
        return undefined;
      }
      layers.push({ x, y, blur, spread, color });
    }
    return layers;
  }

  private readMaterials() {
    const block = this.blocks.get("material");
    if (block?.args.length) this.issues.error(block.line, `material takes no settings; put each material on its own line below it, as in   glass blur=24 fill=surface/70`);
    for (const item of block?.items ?? []) {
      if (item.broken) continue;
      const read = (line: number, args: Token[], what: string) => {
        const { out, words } = this.settings(line, args, MATERIAL_KEYS, what);
        if (words.length) this.issues.error(line, `${what} takes ${list(MATERIAL_KEYS.filter((k) => k !== "about").map((k) => k + "="))}; "${words[0]}" isn't one`);
        return out;
      };
      const base = read(item.line, item.args, "a material");
      const modes: Record<string, { blur: number; fill?: string; line?: string }> = {};
      const perMode = this.modeLines(item);
      for (const m of this.modes) {
        const props = { ...base };
        for (const at of this.chain(m).reverse()) Object.assign(props, perMode[at]?.props ?? {});
        const ln = this.chain(m).map((c) => perMode[c]?.line).find(Boolean) ?? item.line;
        const blur = props.blur !== undefined ? this.number(ln, "blur", props.blur, 0, 200) : 0;
        if (props.fill !== undefined) this.colorRef(props.fill, ln, "fill", false);
        if (props.line !== undefined) this.colorRef(props.line, ln, "line", true);
        modes[m] = { blur: blur ?? 0, fill: props.fill, line: props.line };
      }
      for (const [, v] of Object.entries(perMode)) read(v.line, v.args, "a material's mode line");
      this.style.materials.push({ name: item.name, line: item.line, about: base.about, modes });
    }
  }

  /** An item's per-mode lines by mode name. */
  private modeLines(item: Item): Record<string, { line: number; args: Token[]; props: Record<string, string> }> {
    const out: Record<string, { line: number; args: Token[]; props: Record<string, string> }> = {};
    for (const c of item.children) {
      if (out[c.name]) this.issues.error(c.line, `${item.name} already has a ${c.name} line (line ${out[c.name].line})`);
      const props: Record<string, string> = {};
      for (const t of c.args) if (t.kind === "setting") props[t.key] = t.value;
      out[c.name] = { line: c.line, args: c.args, props };
    }
    return out;
  }

  private readElevation() {
    const block = this.blocks.get("elevation");
    let flat = false;
    for (const t of block?.args ?? []) {
      if (t.kind === "word" && t.value === "flat") flat = true;
      else this.issues.error(block!.line, `the elevation line takes only flat (no shadows anywhere); levels go on their own lines below it`);
    }
    this.style.elevation.flat = flat;
    const items = new Map<string, Item>();
    for (const item of block?.items ?? []) {
      if (item.broken) continue;
      if (items.has(item.name)) {
        this.issues.error(item.line, `elevation level ${item.name} is already on line ${items.get(item.name)!.line}`);
        continue;
      }
      if (!(LEVELS as readonly string[]).includes(item.name)) {
        const close = closeMatches(item.name, [...LEVELS]);
        if (close.length) this.issues.warn(item.line, `${item.name} isn't a known level (did you mean ${close.join(", ")}?); extra levels are fine, but components only use the known ones`);
      }
      items.set(item.name, item);
    }
    const names = [...new Set([...LEVELS, ...items.keys()])];
    for (const name of names) {
      const item = items.get(name);
      const d = LEVEL_DEFAULTS[name];
      const level: Level = { name, line: item?.line, from: item ? "written" : "default", modes: {} };
      const base = item ? this.settings(item.line, item.args, LEVEL_KEYS, "an elevation level") : { out: {} as Record<string, string>, words: [] as string[] };
      level.about = base.out.about;
      delete base.out.about;
      if (item && base.words.length) this.issues.error(item.line, `an elevation level takes ${list(LEVEL_KEYS.filter((k) => k !== "about").map((k) => k + "="))}; "${base.words[0]}" isn't one`);
      const perMode = item ? this.modeLines(item) : {};
      for (const [m, v] of Object.entries(perMode)) {
        const extra = this.settings(v.line, v.args, LEVEL_KEYS, `a level's ${m} line`);
        if (extra.words.length) this.issues.error(v.line, `a level's ${m} line takes ${list(LEVEL_KEYS.filter((k) => k !== "about").map((k) => k + "="))}; "${extra.words[0]}" isn't one`);
      }
      for (const m of this.modes) {
        const props: Record<string, string> = { ...base.out };
        for (const at of this.chain(m).reverse()) Object.assign(props, perMode[at]?.props ?? {});
        const ln = this.chain(m).map((c) => perMode[c]?.line).find(Boolean) ?? item?.line ?? this.lineOf("elevation");
        const dark = this.isDarkMode(m) || (this.roleColor("background", m, 0) && isDark(this.roleColor("background", m, 0)!));
        if (props.shadow !== undefined && flat && props.shadow !== "none") {
          this.issues.error(ln, `elevation flat means no shadows; remove shadow= from ${name} or drop flat`);
          delete props.shadow;
        }
        const shadowRaw = props.shadow ?? (flat || dark || !d ? "none" : d.shadow);
        const shadow = this.shadow(shadowRaw, ln, m) ?? [];
        const tintRaw = props.tint;
        const tint = tintRaw !== undefined ? (this.number(ln, "tint", tintRaw, 0, 100) ?? 0) : d && dark ? d.darkTint : 0;
        const lineRef = props.line ?? (d && (flat || (dark && d.darkLine)) ? "line" : undefined);
        if (props.fill !== undefined && props.material !== undefined) this.issues.error(ln, `${name} has fill= and material=; a level uses one or the other`);
        if (props.fill !== undefined) this.colorRef(props.fill, ln, "fill", false);
        if (props.line !== undefined) this.colorRef(props.line, ln, "line", true);
        if (props.material !== undefined && !this.style.materials.some((x) => x.name === props.material))
          this.issues.error(ln, `material=${props.material}: there's no material named ${props.material}${didYouMean(props.material, this.style.materials.map((x) => x.name))}; define it in a material section`);
        level.modes[m] = { fill: props.material ? undefined : (props.fill ?? "surface"), material: props.material, shadow, line: lineRef === "none" ? undefined : lineRef, tint };
      }
      this.style.elevation.levels.push(level);
    }
  }

  // -------------------------------------------------------------------------
  // Motion, layout, icons, states, focus

  private duration(line: number, key: string, raw: string): number | undefined {
    const m = raw.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
    if (!m) {
      this.issues.error(line, `${key}=${raw}: a duration needs a unit, as in ${key}=120ms or ${key}=0.2s`);
      return undefined;
    }
    return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
  }

  private readMotion() {
    const block = this.blocks.get("motion");
    const motion = this.style.motion;
    motion.durations = { ...DURATION_DEFAULTS };
    motion.easings = { ...EASING_DEFAULTS };
    if (!block) return;
    motion.from = "written";
    const written: Record<string, number> = {};
    for (const t of block.args) {
      if (t.kind !== "setting") {
        this.issues.error(block.line, `motion takes name=duration pairs and reduced=, as in motion fast=120ms normal=200ms reduced=fade`);
        continue;
      }
      if (t.key === "reduced") {
        if ((REDUCED as readonly string[]).includes(t.value)) motion.reduced = t.value;
        else this.issues.error(block.line, `reduced=${t.value}: reduced motion is fade (cross-fade only) or none (no animation)`);
        continue;
      }
      const ms = this.duration(block.line, t.key, t.value);
      if (ms !== undefined) written[t.key] = ms;
    }
    if (Object.keys(written).length) motion.durations = written;
    const ease = block.children.filter((c) => c.kind === "ease");
    if (ease.length > 1) this.issues.error(ease[1].line, `motion has one ease line (the first is line ${ease[0].line})`);
    const easings: Record<string, [number, number, number, number]> = {};
    for (const t of ease[0]?.args ?? []) {
      const ln = ease[0].line;
      if (t.kind !== "setting") {
        this.issues.error(ln, `ease takes name=x1,y1,x2,y2 pairs, as in ease standard=0.2,0,0,1 enter=0,0,0,1`);
        continue;
      }
      if (t.value === "linear") {
        easings[t.key] = [0, 0, 1, 1];
        continue;
      }
      const parts = t.value.split(",").map((p) => num(p));
      if (parts.length !== 4 || parts.some((p) => p === undefined) || [parts[0], parts[2]].some((x) => x! < 0 || x! > 1)) {
        this.issues.error(ln, `${t.key}=${t.value}: an easing is four numbers x1,y1,x2,y2 (x between 0 and 1), or linear`);
        continue;
      }
      easings[t.key] = parts as [number, number, number, number];
    }
    if (Object.keys(easings).length) motion.easings = { ...EASING_DEFAULTS, ...easings };
  }

  private readLayout() {
    const block = this.blocks.get("layout");
    const layout = this.style.layout;
    if (!block) {
      layout.breakpoints = Object.entries(BREAKPOINT_DEFAULTS).map(([name, v]) => ({ name, ...v }));
      return;
    }
    layout.from = "written";
    const head = this.settings(block.line, block.args, ["max", "touch"], "the layout line");
    if (head.words.length) this.issues.error(block.line, `the layout line takes max= and touch=; breakpoints go on their own lines below it`);
    if (head.out.max !== undefined) layout.max = this.number(block.line, "max", head.out.max, 1) ?? layout.max;
    if (head.out.touch !== undefined) layout.touch = this.number(block.line, "touch", head.out.touch, 1, 200) ?? layout.touch;
    for (const item of block.items) {
      if (item.broken) continue;
      const { out, words } = this.settings(item.line, item.args, BREAKPOINT_KEYS, "a breakpoint");
      if (words.length) this.issues.error(item.line, `a breakpoint takes min=, columns=, gutter= and margin=, as in ${item.name} min=768 columns=8 gutter=24 margin=32`);
      const d = BREAKPOINT_DEFAULTS[item.name] ?? BREAKPOINT_DEFAULTS.phone;
      const n = (k: "min" | "columns" | "gutter" | "margin", min: number) => (out[k] !== undefined ? (this.number(item.line, k, out[k], min) ?? d[k]) : d[k]);
      if (out.min === undefined && !(item.name in BREAKPOINT_DEFAULTS)) this.issues.error(item.line, `breakpoint ${item.name} needs min=, the narrowest width it applies to`);
      layout.breakpoints.push({ name: item.name, min: n("min", 0), columns: n("columns", 1), gutter: n("gutter", 0), margin: n("margin", 0), about: out.about });
    }
    if (!layout.breakpoints.length) layout.breakpoints = Object.entries(BREAKPOINT_DEFAULTS).map(([name, v]) => ({ name, ...v }));
    layout.breakpoints.forEach((b, i) => {
      const prev = layout.breakpoints[i - 1];
      const item = block.items.find((it) => it.name === b.name);
      if (prev && b.min <= prev.min) this.issues.error(item?.line ?? block.line, `breakpoint ${b.name} (min=${b.min}) must be wider than ${prev.name} (min=${prev.min}); list them narrowest first`);
    });
  }

  private readIcons() {
    const block = this.blocks.get("icons");
    if (!block) return;
    const icons = this.style.icons;
    icons.from = "written";
    const { out, words } = this.settings(block.line, block.args, ["stroke", "sizes", "about", ...PLATFORMS], "the icons line");
    if (words.length > 1) this.issues.error(block.line, `the icons line names one set, as in icons lucide stroke=1.5 sizes=16,20,24`);
    if (words[0]) {
      if (ICON_SETS.includes(words[0])) icons.set = words[0];
      else if (words[0] in PLATFORM_ICON_SETS)
        this.issues.error(block.line, `${words[0]} can't be drawn in the guide (its license limits use outside Apple platforms); write it as ${PLATFORM_ICON_SETS[words[0]]}=${words[0]} after an open set, as in icons lucide ios=${words[0]}`);
      else this.issues.error(block.line, `${words[0]} isn't an icon set crayonbox can draw${didYouMean(words[0], ICON_SETS)}; sets are ${list(ICON_SETS)}`);
    }
    if (out.stroke !== undefined) icons.stroke = this.number(block.line, "stroke", out.stroke, 0.25, 4) ?? icons.stroke;
    if (out.sizes !== undefined) {
      const sizes = out.sizes.split(",").map((s) => num(s));
      if (sizes.some((s) => s === undefined || s <= 0)) this.issues.error(block.line, `sizes=${out.sizes}: sizes are a comma-separated list of numbers, as in sizes=16,20,24`);
      else icons.sizes = sizes as number[];
    }
    for (const p of PLATFORMS) {
      if (out[p] === undefined) continue;
      if (ICON_SETS.includes(out[p]) || PLATFORM_ICON_SETS[out[p]] === p) icons.platforms[p] = out[p];
      else this.issues.error(block.line, `${p}=${out[p]} isn't an icon set for ${p}; use ${list([...ICON_SETS, ...Object.keys(PLATFORM_ICON_SETS).filter((k) => PLATFORM_ICON_SETS[k] === p)])}`);
    }
  }

  private readStates() {
    const block = this.blocks.get("state");
    if (!block) return;
    for (const t of block.args) {
      if (t.kind !== "setting" || !(t.key in STATE_LAYERS)) {
        this.issues.error(block.line, `the state line sets state-layer strength in percent: ${list(Object.keys(STATE_LAYERS).map((k) => `${k}=${STATE_LAYERS[k]}`))}${t.kind === "setting" ? didYouMean(t.key, Object.keys(STATE_LAYERS)) : ""}`);
        continue;
      }
      this.style.states[t.key] = this.number(block.line, t.key, t.value, 0, 100) ?? STATE_LAYERS[t.key];
    }
  }

  private readFocus() {
    const block = this.blocks.get("focus");
    if (!block) return;
    const focus = this.style.focus;
    focus.from = "written";
    const { out, words } = this.settings(block.line, block.args, ["color", "width", "offset"], "the focus line");
    if (words.length) this.issues.error(block.line, `the focus line takes color=, width= and offset=, as in focus color=primary width=2 offset=2`);
    if (out.color !== undefined && this.colorRef(out.color, block.line, "color", false)) focus.color = out.color;
    if (out.width !== undefined) focus.width = this.number(block.line, "width", out.width, 1, 8) ?? focus.width;
    if (out.offset !== undefined) focus.offset = this.number(block.line, "offset", out.offset, -4, 8) ?? focus.offset;
  }

  private headerOnly(kind: "voice" | "imagery") {
    const block = this.blocks.get(kind);
    if (block?.args.length) this.issues.error(block.line, `${kind} takes only about, do and dont lines below it, as in   about "Plain, warm, a little dry."`);
  }

  // -------------------------------------------------------------------------
  // Components

  private readComponents() {
    const seen = new Map<string, number>();
    for (const block of this.file.blocks.filter((b) => b.kind === "component")) {
      const [nameTok, ...args] = block.args;
      if (!nameTok || nameTok.kind !== "word") {
        this.issues.error(block.line, `component needs a name, as in component button height=44; the catalog is ${list(Object.keys(COMPONENTS))}`);
        continue;
      }
      const name = nameTok.value;
      const spec = COMPONENTS[name];
      if (!Object.hasOwn(COMPONENTS, name)) {
        const close = closeMatches(name, Object.keys(COMPONENTS));
        this.issues.error(
          block.line,
          close.length
            ? `${name} isn't a component (did you mean ${close.join(", ")}?)`
            : `${name} isn't in the v0.1 catalog (${list(Object.keys(COMPONENTS))}); custom components come later`,
        );
        continue;
      }
      if (seen.has(name)) {
        this.issues.error(block.line, `component ${name} is already on line ${seen.get(name)}; put its variants, sizes and states under one line`);
        continue;
      }
      seen.set(name, block.line);
      const props = this.componentProps(block.line, args, `component ${name}`, false);
      const c: Component = { name, line: block.line, from: "written", props: { ...spec.props, ...props }, variants: [], sizes: [], states: [] };
      for (const child of block.children) this.componentChild(c, child);
      if (!c.variants.length) c.variants = Object.entries(spec.variants).map(([n, p]) => ({ name: n, props: { ...p } }));
      this.style.components.push(c);
    }
    for (const [name, spec] of Object.entries(COMPONENTS)) {
      if (seen.has(name)) continue;
      this.style.components.push({
        name,
        from: "default",
        props: { ...spec.props },
        variants: Object.entries(spec.variants).map(([n, p]) => ({ name: n, props: { ...p } })),
        sizes: [],
        states: [],
      });
    }
  }

  private componentChild(c: Component, child: Child) {
    if (child.broken) return;
    const list_ = child.kind === "variant" ? c.variants : child.kind === "size" ? c.sizes : c.states;
    if (list_.some((x) => x.name === child.name)) {
      this.issues.error(child.line, `${c.name} already has ${child.kind} ${child.name}`);
      return;
    }
    if (child.kind === "variant" && (KNOWN_ROLES as readonly string[]).includes(child.name)) {
      this.issues.error(child.line, `variant ${child.name}: name variants by how they look (filled, outlined, plain), not by color; ${child.name} is a color`);
      return;
    }
    if (child.kind === "state" && !STATES.includes(child.name)) {
      this.issues.error(child.line, `${child.name} isn't a state${didYouMean(child.name, STATES)}; states are ${list(STATES)}`);
      return;
    }
    const props = this.componentProps(child.line, child.args, `${child.kind} ${child.name}`, child.kind === "size");
    if (child.kind === "size") c.sizes.push({ name: child.name, line: child.line, props });
    else if (child.kind === "variant") c.variants.push({ name: child.name, line: child.line, props });
    else c.states.push({ name: child.name, line: child.line, props });
  }

  private componentProps(line: number, args: Token[], what: string, sizeOnly: boolean): Record<string, string> {
    const { out, words } = this.settings(line, args, COMPONENT_KEYS, what);
    if (words.length) this.issues.error(line, `${what} takes key=value settings (${list(COMPONENT_KEYS.filter((k) => k !== "about"))}); "${words[0]}" isn't one`);
    for (const [k, v] of Object.entries(out)) {
      if (sizeOnly && !SIZE_KEYS.has(k)) {
        this.issues.error(line, `${what}: sizes change dimensions only (height, pad, gap, type, icon, radius); put ${k}= on a variant`);
        delete out[k];
        continue;
      }
      const ok = this.componentValue(k, v, line);
      if (!ok) delete out[k];
    }
    return out;
  }

  private componentValue(key: string, raw: string, line: number): boolean {
    const s = this.style;
    switch (key) {
      case "fill":
        return this.colorRef(raw, line, key, true);
      case "text":
        return this.colorRef(raw, line, key, false);
      case "line":
        return this.colorRef(raw, line, key, true);
      case "border":
        return this.scaleRef(s.border, "border", raw, line, key) !== undefined;
      case "radius":
        return this.scaleRef(s.radius, "radius", raw, line, key) !== undefined;
      case "gap":
        return this.scaleRef(s.space, "space", raw, line, key) !== undefined;
      case "pad": {
        const parts = raw.split(",");
        if (parts.length > 2) {
          this.issues.error(line, `pad=${raw}: pad is one value, or vertical,horizontal, as in pad=sm,lg`);
          return false;
        }
        return parts.every((p) => this.scaleRef(s.space, "space", p, line, key) !== undefined);
      }
      case "height":
        return this.number(line, key, raw, 1, 400) !== undefined;
      case "type":
        if (s.type.some((t) => t.name === raw)) return true;
        this.issues.error(line, `type=${raw}: there's no type style ${raw}${didYouMean(raw, s.type.map((t) => t.name))}`);
        return false;
      case "icon": {
        const n = this.number(line, key, raw, 1, 200);
        if (n !== undefined && !s.icons.sizes.includes(n)) this.issues.warn(line, `icon=${raw} isn't one of the icon sizes (${list(s.icons.sizes.map(String))})`);
        return n !== undefined;
      }
      case "elevation":
        if (s.elevation.levels.some((l) => l.name === raw)) return true;
        this.issues.error(line, `elevation=${raw}: there's no level ${raw}${didYouMean(raw, s.elevation.levels.map((l) => l.name))}; levels are ${list(s.elevation.levels.map((l) => l.name))}`);
        return false;
      case "material":
        if (s.materials.some((m) => m.name === raw)) return true;
        this.issues.error(line, `material=${raw}: there's no material named ${raw}${didYouMean(raw, s.materials.map((m) => m.name))}`);
        return false;
      case "opacity":
        if (raw in s.opacity.values) return true;
        return this.number(line, key, raw, 0, 1) !== undefined;
      default:
        return true;
    }
  }

  // -------------------------------------------------------------------------
  // Rules

  private ruleLines = new Map<string, number>();

  private readRules() {
    const r = this.style.rules;
    r.touch = this.style.layout.touch;
    for (const block of this.file.blocks.filter((b) => b.kind === "rule")) {
      if (block.args.length !== 1) {
        this.issues.error(block.line, `one rule per line, as in rule contrast=AA; rules are ${list(Object.keys(RULES))}`);
        continue;
      }
      const t = block.args[0];
      const key = t.kind === "setting" ? t.key : t.kind === "word" ? t.value : "";
      const spec = RULES[key];
      if (!Object.hasOwn(RULES, key)) {
        this.issues.error(block.line, `${key || "that"} isn't a rule${didYouMean(key, Object.keys(RULES))}; rules are ${list(Object.keys(RULES))}. Taste (where primary goes, how bold type gets) goes in about=, do or dont lines`);
        continue;
      }
      if (this.ruleLines.has(key)) {
        this.issues.error(block.line, `rule ${key} is already on line ${this.ruleLines.get(key)}`);
        continue;
      }
      this.ruleLines.set(key, block.line);
      if (t.kind !== "setting") {
        this.issues.error(block.line, `rule ${key} needs a value: ${spec.about}`);
        continue;
      }
      if (key === "contrast") {
        const level = t.value.toUpperCase();
        if (!(level in CONTRAST_LEVELS)) this.issues.error(block.line, `contrast=${t.value}: the level is AA or AAA`);
        else {
          if (level !== t.value) this.issues.warn(block.line, `write contrast=${level} (read as ${level})`);
          r.contrast = level;
        }
      } else if (key === "min-text") r.minText = this.number(block.line, key, t.value, 1, 100) ?? r.minText;
      else if (key === "touch") r.touch = this.number(block.line, key, t.value, 1, 200) ?? r.touch;
    }
  }

  // -------------------------------------------------------------------------
  // Checks across families

  private pairs: Pair[] = [];

  private checkContrast() {
    const need = CONTRAST_LEVELS[this.style.rules.contrast];
    const level = this.style.rules.contrast;
    const ruleWhere = this.ruleLines.has("contrast") ? ` (rule on line ${this.ruleLines.get("contrast")})` : "";
    const role = (n: string) => this.style.roles.find((r) => r.name === n);
    const pairs: [string, string][] = [
      ["text", "background"],
      ["text", "surface"],
      ["muted", "background"],
      ["muted", "surface"],
      ["primary", "background"],
      ["danger", "surface"],
      ...FILL_ROLES.filter((f) => role(f) && role(`on-${f}`)).map((f) => [`on-${f}`, f] as [string, string]),
    ];
    for (const [fgName, bgName] of pairs) {
      const fg = role(fgName);
      const bg = role(bgName);
      if (!fg || !bg || this.failed.has(fgName) || this.failed.has(bgName)) continue;
      const ratios: Record<string, number> = {};
      let reported = false;
      for (const m of this.modes) {
        if (!fg.colors[m] || !bg.colors[m]) continue;
        const ratio = contrast(fg.colors[m], bg.colors[m]);
        ratios[m] = ratio;
        if (ratio >= need || reported) continue;
        reported = true;
        if (fg.from === "auto") {
          const text = contrast(this.roleColor("text", m, 0)!, bg.colors[m]);
          const surface = contrast(this.roleColor("surface", m, 0)!, bg.colors[m]);
          const fix = this.suggestStep(bgName, m, (c) => Math.max(contrast(this.roleColor("text", m, 0)!, c), contrast(this.roleColor("surface", m, 0)!, c)) >= need);
          this.issues.error(
            bg.line ?? this.lineOf("color"),
            `nothing reads on ${bgName}${this.modeWords(m)}: text is ${fmt1(text)}:1 and surface ${fmt1(surface)}:1, ${level} needs ${need}${ruleWhere}; ${fix ? `try ${fix}, ` : ""}make ${bgName} darker or lighter, or write on-${bgName}`,
          );
        } else {
          const line = fg.line ?? bg.line ?? this.lineOf("color");
          const fix = this.suggestStep(fgName, m, (c) => contrast(c, bg.colors[m]) >= need);
          // A written role with no value for this mode is the same in every mode; say so.
          const same = [fg, bg].find((r) => r.from === "written" && m !== this.modes[0] && !this.chain(m).some((c) => this.colors.get(r.name)?.overrides?.[c] !== undefined));
          const hint = same ? `; ${same.name} has no ${m}= value, so it's ${toHex(same.colors[m])} in every mode` : "";
          this.issues.error(line, `${fgName} on ${bgName} is ${fmt1(ratio)}:1${this.modeWords(m)}; ${level} needs ${need}${ruleWhere}${fix ? `; try ${fix}` : ""}${hint}`);
        }
      }
      this.pairs.push({ fg: fgName, bg: bgName, ratios, pass: Object.values(ratios).every((r) => r >= need) });
    }
    // Written component variants: their text on their fill.
    for (const c of this.style.components.filter((x) => x.from === "written")) {
      for (const v of c.variants.filter((x) => x.line)) {
        const props = { ...c.props, ...v.props };
        const fill = props.fill && props.fill !== "none" ? props.fill : "background";
        const text = labelColor(props);
        if (this.colors.get(fill.split("/")[0])?.kind === "gradient") continue;
        // The same two roles as a pair checked above: already reported there, so no echo.
        if (this.pairs.some((p) => p.fg === text && p.bg === fill)) continue;
        for (const m of this.modes) {
          const bg = this.quietColor(fill, m);
          const fg = this.quietColor(text, m);
          if (!bg || !fg) break;
          const ratio = contrast(fg, over(bg, this.roleColor("background", m, 0) ?? bg));
          if (ratio < need) {
            this.issues.error(v.line!, `${c.name} ${v.name}: ${text} on ${fill === "background" ? "the background" : fill} is ${fmt1(ratio)}:1${this.modeWords(m)}; ${level} needs ${need}${ruleWhere}`);
            break;
          }
        }
      }
    }
    this.checkStateOverrides(need, level, ruleWhere);
  }

  /** A component's state lines that change fill or text: each variant's label must still read on the new fill. */
  private checkStateOverrides(need: number, level: string, ruleWhere: string) {
    for (const c of this.style.components.filter((x) => x.from === "written")) {
      for (const st of c.states.filter((x) => x.props.fill !== undefined || x.props.text !== undefined)) {
        for (const m of this.modes) {
          const failing: string[] = [];
          let fillShown = "";
          for (const v of c.variants) {
            const own = { ...c.props, ...v.props };
            const fill = st.props.fill ?? (own.fill && own.fill !== "none" ? own.fill : "background");
            if (this.colors.get(fill.split("/")[0])?.kind === "gradient") continue;
            const text = labelColor(own, st.props);
            const bg = this.quietColor(fill, m);
            const fg = this.quietColor(text, m);
            if (!bg || !fg) continue;
            const ratio = contrast(fg, over(bg, this.roleColor("background", m, 0) ?? bg));
            if (ratio < need) failing.push(`${v.name}'s ${text} is ${fmt1(ratio)}:1`);
            fillShown = fill;
          }
          if (failing.length) {
            this.issues.error(
              st.line,
              `${c.name} ${st.name}: on ${fillShown}${this.modeWords(m)}, ${failing.join(", ")}; ${level} needs ${need}${ruleWhere}. A state line applies to every variant; add text= to it, or give the variants their own colors`,
            );
            break;
          }
        }
      }
    }
  }

  /** A color expression without reporting (it was already checked where it was written). */
  private quietColor(expr: string, mode: string): RGBA | undefined {
    const scratch = new Issues();
    const real = this.issues;
    this.issues = scratch;
    try {
      return this.color(expr, 0, mode);
    } finally {
      this.issues = real;
    }
  }

  /** For a role set to a ramp step: the nearest other step of that ramp that passes. */
  private suggestStep(roleName: string, mode: string, passes: (c: RGBA) => boolean): string | undefined {
    const def = this.colors.get(roleName);
    if (!def || def.kind !== "role") return undefined;
    const expr = this.chain(mode).map((m) => def.overrides?.[m]).find((v) => v !== undefined) ?? def.value!;
    const m = expr.match(/^(.+)-(\d+)$/);
    if (!m || !STEPS.includes(Number(m[2]) as (typeof STEPS)[number])) return undefined;
    const at = STEPS.indexOf(Number(m[2]) as (typeof STEPS)[number]);
    const order = STEPS.map((s, i) => ({ s, d: Math.abs(i - at) })).filter((x) => x.d > 0).sort((a, b) => a.d - b.d);
    for (const { s } of order) {
      const c = this.colors.get(`${m[1]}-${s}`)?.fixed;
      if (c && passes(c)) return `${m[1]}-${s}`;
    }
    return undefined;
  }

  private checkTypeRules() {
    const { minText } = this.style.rules;
    const block = this.blocks.get("type");
    for (const t of this.style.type) {
      const line = t.line ?? block?.line ?? this.file.line;
      if (t.size < minText) {
        const where = this.ruleLines.has("min-text") ? `the min-text rule on line ${this.ruleLines.get("min-text")}` : `the default min-text of ${minText}`;
        const how = t.from === "auto" ? ` (${t.name} works out to ${t.size} from ${t.how}; write ${t.name} ${minText} or raise body)` : "";
        this.issues.error(line, `${t.name} is ${t.size}, under ${where}${how}`);
      }
    }
  }

  private checkTouch() {
    const touch = this.style.rules.touch;
    const where = this.ruleLines.has("touch") ? `the touch rule (line ${this.ruleLines.get("touch")})` : `the ${touch} touch target`;
    for (const c of this.style.components) {
      if (!COMPONENTS[c.name].touch) continue;
      const h = num(c.props.height ?? "");
      if (h !== undefined && h < touch && c.from === "written") this.issues.error(c.line!, `${c.name} is ${h} tall, under ${where}; make it at least ${touch}`);
      for (const s of c.sizes) {
        const sh = num(s.props.height ?? "");
        if (sh !== undefined && sh < touch) this.issues.warn(s.line, `${c.name} size ${s.name} is ${sh} tall, under ${where}; fine for pointer-only (web) layouts`);
      }
    }
  }

  get pairList() {
    return this.pairs;
  }
}

/** A component's label color: written text=, else the on- partner of its fill role, else text. A state's text= wins. */
export function labelColor(own: Record<string, string>, state: Record<string, string> = {}): string {
  if (state.text) return state.text;
  if (own.text) return own.text;
  const fillRole = own.fill && own.fill !== "none" ? own.fill.split("/")[0] : undefined;
  return fillRole && FILL_ROLES.includes(fillRole) ? `on-${fillRole}` : "text";
}

const fmt1 = (n: number) => (Math.floor(n * 10) / 10).toFixed(1);
const sup = (n: number) => String(n).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);

// ---------------------------------------------------------------------------
// Summary

function summarize(style: Style, pairs: Pair[]): Summary {
  const need = CONTRAST_LEVELS[style.rules.contrast];
  const auto: string[] = [];
  const onAuto = style.roles.filter((r) => r.from === "auto").map((r) => r.name);
  if (onAuto.length) auto.push(onAuto.join(", "));
  const typeAuto = style.type.filter((t) => t.from === "auto").map((t) => t.name);
  if (typeAuto.length) auto.push(`type ${compactNames(typeAuto)}`);
  const ramps = [...new Set(style.palette.filter((p) => p.ramp && /-\d+$/.test(p.name)).map((p) => p.name.replace(/-\d+$/, "")))];
  if (ramps.length) auto.push(`ramps ${ramps.map((r) => `${r}-50…950`).join(", ")}`);
  if (style.space.generated) auto.push(`space ${Object.keys(style.space.values)[0]}…${Object.keys(style.space.values).at(-1)}`);

  const defaulted: string[] = [];
  const roleDefaults = style.roles.filter((r) => r.from === "default").map((r) => r.name);
  if (roleDefaults.length) defaulted.push(`roles ${roleDefaults.join(", ")}`);
  if (style.type.some((t) => t.name === "body" && t.from === "default")) defaulted.push("body 16");
  if (style.fonts.some((f) => f.from === "default")) defaulted.push(`fonts ${style.fonts.filter((f) => f.from === "default").map((f) => f.family).join(", ")}`);
  for (const k of ["space", "radius", "border", "opacity"] as const) if (style[k].from === "default") defaulted.push(k);
  const lvl = style.elevation.levels.filter((l) => l.from === "default").map((l) => l.name);
  if (lvl.length) defaulted.push(`levels ${lvl.join(", ")}`);
  if (style.motion.from === "default") defaulted.push("motion");
  else if (Object.keys(style.motion.easings).every((k) => k in EASING_DEFAULTS)) defaulted.push("easings");
  if (style.layout.from === "default") defaulted.push("layout");
  if (style.icons.from === "default") defaulted.push("icons");
  if (style.focus.from === "default") defaulted.push("focus ring");
  const comps = style.components.filter((c) => c.from === "default").length;
  if (comps) defaulted.push(`${comps} component${comps === 1 ? "" : "s"}`);

  const rolesCount = style.roles.filter((r) => !r.name.startsWith("on-")).length;
  const written = style.components.filter((c) => c.from === "written").length;
  const counts = [
    `${style.modes.length} mode${style.modes.length === 1 ? "" : "s"}`,
    `${rolesCount} roles`,
    `${style.type.length} type styles`,
    `${written} component${written === 1 ? "" : "s"}`,
  ].join(" · ");
  return { title: style.name, modes: style.modes, counts, pairs, auto, defaulted, required: need, level: style.rules.contrast };
}

/** h1, h2, h3, caption → "h1–h3, caption". */
function compactNames(names: string[]): string {
  const hs = names.filter((n) => HEADING.test(n)).map((n) => Number(n.slice(1))).sort((a, b) => a - b);
  const rest = names.filter((n) => !HEADING.test(n));
  const parts: string[] = [];
  if (hs.length) {
    const contiguous = hs.every((h, i) => i === 0 || h === hs[i - 1] + 1);
    parts.push(contiguous && hs.length > 2 ? `h${hs[0]}–h${hs.at(-1)}` : hs.map((h) => `h${h}`).join(", "));
  }
  return [...parts, ...rest].join(", ");
}

/** The summary `check` prints when there are no errors. */
export function formatSummary(s: Summary): string {
  const label = (p: Pair) => `${p.fg}/${p.bg}`;
  const w = Math.max(...s.pairs.map((p) => label(p).length), 8) + 2;
  const out = [`${s.title} · ${s.counts}`];
  out.push(`contrast (${s.level}, ${s.required}:1)`.padEnd(w + 2) + s.modes.map((m) => m.padEnd(10)).join("").trimEnd());
  for (const p of s.pairs) {
    const cells = s.modes.map((m) => {
      const r = p.ratios[m];
      return r === undefined ? "–".padEnd(10) : `${fmt1(r)} ${r >= s.required ? "✓" : "✗"}`.padEnd(10);
    });
    out.push(`  ${label(p).padEnd(w)}${cells.join("").trimEnd()}`);
  }
  if (s.auto.length) out.push(`auto     ${s.auto.join(" · ")}`);
  if (s.defaulted.length) out.push(`default  ${s.defaulted.join(" · ")}`);
  return out.join("\n");
}

export { toHex };
