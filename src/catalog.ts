/**
 * Everything the language knows: sections, known names, defaults, components and
 * rules. Source of truth for the parser and checker (and later the guide).
 */

/** Sections in canonical order: `fmt` sorts by it, and the SVG guide follows it. */
export const SECTIONS = [
  "palette",
  "color",
  "gradient",
  "font",
  "type",
  "layout",
  "space",
  "material",
  "elevation",
  "radius",
  "border",
  "opacity",
  "motion",
  "icons",
  "state",
  "focus",
  "component",
  "voice",
  "imagery",
  "rule",
] as const;
export type SectionKind = (typeof SECTIONS)[number];

/** Sections whose lines below the header are named items. */
export const ITEM_SECTIONS = new Set<SectionKind>([
  "palette",
  "color",
  "gradient",
  "font",
  "type",
  "layout",
  "space",
  "material",
  "elevation",
  "radius",
  "border",
  "opacity",
]);

/** Sections that may appear more than once (one line each). */
export const REPEATABLE = new Set<SectionKind>(["component", "rule"]);

/** Sections whose items can take indented per-mode lines (`dark tint=4 shadow=none`). */
export const MODE_LINE_SECTIONS = new Set<SectionKind>(["material", "elevation"]);

export const GUIDANCE = ["about", "do", "dont"] as const;
export type GuidanceKind = (typeof GUIDANCE)[number];

export const PLATFORMS = ["web", "ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Words that can't name an item, a mode or a variant. */
export const RESERVED = new Set<string>(["style", "variant", "size", "ease", "none", ...SECTIONS, ...GUIDANCE, ...PLATFORMS]);

// ---------------------------------------------------------------------------
// Color

export const KNOWN_ROLES = ["background", "surface", "text", "muted", "line", "primary", "secondary", "danger", "success", "warning"] as const;

/** Roles that are filled with color and get an automatic `on-` partner for labels on top. */
export const FILL_ROLES = ["primary", "secondary", "danger", "success", "warning"];

/** Roles a file gets without writing them: grayscale plus status colors (like tsquare). `secondary` only exists when written. */
export const DEFAULT_ROLES: Record<"light" | "dark", Record<string, string>> = {
  light: {
    background: "#F7F7F7",
    surface: "#FFFFFF",
    text: "#1A1A1A",
    muted: "#616161",
    line: "#D9D9D9",
    primary: "#1A1A1A",
    danger: "#C62828",
    success: "#2E7D32",
    warning: "#8A5300",
  },
  dark: {
    background: "#121212",
    surface: "#1E1E1E",
    text: "#F2F2F2",
    muted: "#A8A8A8",
    line: "#3A3A3A",
    primary: "#F2F2F2",
    danger: "#EF9A9A",
    success: "#A5D6A7",
    warning: "#FFCC80",
  },
};

/** Words models often write for a color, with what to write instead. */
export const COLOR_WORDS: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  transparent: "none",
};

// ---------------------------------------------------------------------------
// Type

export const TYPE_STYLES = ["display", "body", "label", "caption", "code"] as const;
export const HEADING = /^h([1-9])$/;
export const TYPE_DEFAULTS = { ratio: 1.25, body: 16, headings: 3, warnPastHeading: 4 };
export const TYPE_KEYS = ["font", "weight", "line", "tracking", "features", "about"] as const;
export const TYPE_SWITCHES = ["upper", "italic"] as const;

export type TypeDefaults = { weight: number; line: number };
export const STYLE_DEFAULTS: Record<string, TypeDefaults> = {
  display: { weight: 600, line: 1.1 },
  heading: { weight: 600, line: 1.2 },
  body: { weight: 400, line: 1.5 },
  label: { weight: 500, line: 1.2 },
  caption: { weight: 400, line: 1.4 },
  code: { weight: 400, line: 1.5 },
  other: { weight: 400, line: 1.5 },
};

export const DEFAULT_FONT = { name: "sans", family: "Inter", fallback: ["system-ui", "sans-serif"] };
export const DEFAULT_MONO = { name: "mono", family: "JetBrains Mono", fallback: ["monospace"] };

// ---------------------------------------------------------------------------
// Scales

/** Size names in order, with their multiple of `space base=`. */
export const SPACE_STEPS: [string, number][] = [
  ["xs", 1],
  ["sm", 2],
  ["md", 3],
  ["lg", 4],
  ["xl", 6],
  ["2xl", 8],
  ["3xl", 12],
];
export const SPACE_BASE = 4;
export const RADIUS_DEFAULTS: Record<string, number> = { sm: 4, md: 8, lg: 12, full: 9999 };
/** Bare words a radius line accepts as names with a fixed value. */
export const RADIUS_WORDS: Record<string, number> = { none: 0, full: 9999 };
export const BORDER_DEFAULTS: Record<string, number> = { hairline: 1 };
export const OPACITY_DEFAULTS: Record<string, number> = { disabled: 0.4, scrim: 0.5 };

// ---------------------------------------------------------------------------
// Elevation and materials

export const LEVELS = ["raised", "floating", "modal"] as const;
export const LEVEL_KEYS = ["fill", "material", "shadow", "line", "tint", "about"] as const;
export const MATERIAL_KEYS = ["blur", "fill", "line", "about"] as const;

/** Default levels. In a mode with a dark background, shadows give way to tint (and a line from floating up). */
export const LEVEL_DEFAULTS: Record<string, { shadow: string; darkTint: number; darkLine: boolean; flatTint: number }> = {
  raised: { shadow: "0,1,3,#000000/12", darkTint: 4, darkLine: false, flatTint: 0 },
  floating: { shadow: "0,8,24,#000000/16", darkTint: 8, darkLine: true, flatTint: 0 },
  modal: { shadow: "0,24,48,#000000/24", darkTint: 12, darkLine: true, flatTint: 0 },
};

// ---------------------------------------------------------------------------
// Motion, layout, icons, states

export const DURATION_DEFAULTS: Record<string, number> = { fast: 100, normal: 200, slow: 300 };
export const EASING_DEFAULTS: Record<string, [number, number, number, number]> = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
};
export const REDUCED = ["fade", "none"] as const;

export const BREAKPOINT_KEYS = ["min", "columns", "gutter", "margin", "about"] as const;
export const BREAKPOINT_DEFAULTS: Record<string, { min: number; columns: number; gutter: number; margin: number }> = {
  phone: { min: 0, columns: 4, gutter: 16, margin: 16 },
  tablet: { min: 768, columns: 8, gutter: 24, margin: 32 },
  desktop: { min: 1200, columns: 12, gutter: 24, margin: 48 },
};
export const LAYOUT_DEFAULTS = { max: 1200, touch: 44, androidTouch: 48 };

/** Icon sets the guide can draw (open licenses). */
export const ICON_SETS = ["lucide", "phosphor", "material-symbols"];
/** Sets allowed only as a platform override, shown as a note. */
export const PLATFORM_ICON_SETS: Record<string, Platform> = { "sf-symbols": "ios" };
export const ICON_DEFAULTS = { set: "lucide", stroke: 1.5, sizes: [16, 20, 24] };

export const STATE_LAYERS: Record<string, number> = { hover: 8, pressed: 12, selected: 12 };
export const STATES = ["hover", "pressed", "focus", "disabled", "selected", "error"];
export const FOCUS_DEFAULTS = { color: "primary", width: 2, offset: 2 };

// ---------------------------------------------------------------------------
// Components

export const COMPONENT_KEYS = [
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
] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];
/** What a size may change: dimensions only, never color. */
export const SIZE_KEYS = new Set<string>(["height", "pad", "gap", "type", "icon", "radius", "about"]);

export type ComponentSpec = {
  props: Partial<Record<ComponentKey, string>>;
  variants: Record<string, Partial<Record<ComponentKey, string>>>;
  /** The height is the tap target, so the touch rule applies. */
  touch: boolean;
};

export const COMPONENTS: Record<string, ComponentSpec> = {
  button: {
    props: { height: "44", pad: "0,lg", radius: "md", type: "label" },
    variants: { filled: { fill: "primary" }, plain: { fill: "none", text: "primary" } },
    touch: true,
  },
  input: {
    props: { height: "44", pad: "0,md", radius: "sm", type: "body", fill: "surface", line: "line" },
    variants: {},
    touch: true,
  },
  card: { props: { elevation: "raised", radius: "md", pad: "lg" }, variants: {}, touch: false },
  badge: {
    props: { height: "24", pad: "0,sm", radius: "full", type: "caption" },
    variants: { plain: { fill: "none", text: "text", line: "line" }, filled: { fill: "primary" } },
    touch: false,
  },
  listitem: { props: { height: "56", pad: "0,lg", gap: "md", type: "body" }, variants: {}, touch: true },
  tabs: { props: { height: "44", pad: "0,md", type: "label" }, variants: {}, touch: true },
  checkbox: { props: { height: "20", radius: "sm" }, variants: {}, touch: false },
  radio: { props: { height: "20", radius: "full" }, variants: {}, touch: false },
  switch: { props: { height: "24", radius: "full" }, variants: {}, touch: false },
};

// ---------------------------------------------------------------------------
// Rules

/**
 * Rules check measurable quality only. Taste (where primary may appear, how heavy
 * type may get) is guidance: about=, do and dont lines; checking code against it
 * is `crayonbox audit`, later.
 */
export type RuleSpec = { about: string };
export const RULES: Record<string, RuleSpec> = {
  contrast: { about: "contrast=AA or contrast=AAA" },
  "min-text": { about: "min-text=12 (the smallest type size allowed)" },
  touch: { about: "touch=44 (the smallest tap target)" },
};
export const CONTRAST_LEVELS: Record<string, number> = { AA: 4.5, AAA: 7 };
export const RULE_DEFAULTS = { contrast: "AA", minText: 12 };
