# CLAUDE.md

Context for working on this repo. The spec is the **crayonbox language guide (draft v0.1)**, a Claude Doc: https://claude.ai/code/artifact/072965a4-967c-492d-b773-8ebf3980edc2. Where the code and the spec disagree, propose a change to the spec before building around it. Parked questions live in `ROADMAP.md`. This file covers why the code is built this way and the traps.

## Name

**crayonbox**, chosen 2026-10-12: the box of crayons you're handed is a limited set you choose from, which is what a design system is; and tsquare draws the outlines that crayonbox colors in. Files are `.crayon`, code fences ```` ```crayonbox ````. Checked: npm `crayonbox` free, no GitHub org, nothing in design or dev tools on the web (a 1994 DOS kids' coloring program). Rejected: stylist (npm taken; yonaskolb/Stylist and uber/stylist are the same idea), primer (GitHub's design system), undercoat (a new tool with the same pitch, GitHub org taken), tailor (zalando/tailor; sleekbyte/tailor is a Swift linter), bespoke (bespoke.js), mock (testing). Not yet checked: domains. The local folder is still named `stls`; renaming it is the user's call.

## What this is for

**LLMs writing style guides** that are real (values code uses, not context), checked (contrast in every mode, rules) and drawable (an SVG guide, milestone 2). Error messages feed the model's repair loop, so every problem names its line and says what to do. Modeled on tsquare (`../wireframe`) and beatsheet (`../beatsheet`) for philosophy and repo shape, not for names: crayonbox names things the way designers do (`primary`, `switch`).

## Decisions already made (all are in the spec's Decision log)

- crayonbox is the source; DESIGN.md and DTCG `tokens.json` are outputs. Values are real. The drawing test decides what's in.
- Color: optional palette → roles. Known roles: background, surface, text, muted, line, primary, secondary (optional), danger, success, warning. `on-` colors are automatic (text or surface, whichever reads better, per mode).
- Modes: one axis; first is the default; a mode named with another's prefix (`dark-hc`) starts from it. Inline `dark=` on one-value lines; own indented line for multi-property changes (elevation, material).
- Type: display, h1…hN, body, label, caption, code. Sizes not written come from body and the ratio.
- Spacing uses size names (xs…3xl); raw numbers warn. Variants are named by look, never by color.

## Decided after the first build (decisions 51–56 in the spec)

- **Names are unique per kind.** Space and radius both use `sm`/`md`; a property knows which scale it reads. Colors (palette, ramp steps, roles, gradients) share one namespace.
- **Defaults follow the page.** Unwritten roles take dark defaults in a mode whose written background (or surface) is dark; with neither written, by the mode's name (dark chain). Otherwise `surface #FFFFFF` with no `dark=` floods the dark mode with contrast errors.
- **Touch rule:** a component's default size under the target is an error; a smaller `size` is a warning (pointer-only layouts need small buttons).
- **Three rules only:** contrast, min-text, touch. A rule must be able to catch a real mistake in the file. `primary-only` and `max-weight` only caught the author contradicting themselves; they wait for `crayonbox audit` (ROADMAP.md). `reduced-motion` could never fail and was dropped.
- **fmt order is the guide's order**, so `radius` sorts after `elevation`.
- `examples/field-notes.crayon` is the spec's example after the checker caught four real problems in it (primary 4.4:1 on paper, danger 2.5:1 in dark, a 40-tall button, the old primary-only rule).

## Commands

```bash
npm install
npx tsc                                       # typecheck (no emit)
npm test                                      # node:test via tsx
npm run check -- examples/field-notes.crayon    # problems by line, or the summary
npm run fmt -- file.crayon [-w]                 # tidy (keeps comments)
```

## Code map

- `src/catalog.ts`: sections and their order, known roles and type styles, every default, the component catalog, rules. Source of truth for the parser and checker (and later the guide).
- `src/color.ts`: color parsing (hex, rgb, hsl, oklch), sRGB ↔ OKLab, ramps (`rampAround`, `rampBetween`), WCAG 2 contrast. No dependencies.
- `src/parse.ts`: tokenizer (parentheses group, so `oklch(55% 0.1 145)` is one word) and text → `StyleFile` (blocks, items, children, guidance, per-line roles for fmt). Line-local checks only.
- `src/check.ts`: the `Checker` resolves every family into `Style` with provenance (written / auto / default), resolves colors per mode lazily with cycle detection, runs contrast and rules, and builds the `Summary`.
- `src/fmt.ts`: canonical order, two-space levels, comments travel with the line below, inner spacing kept.
- `src/issues.ts`, `src/suggest.ts`: copied from beatsheet.
- `test/`: `language.test.ts` (example, summary, derivations), `errors.test.ts` (every message with its line), `color.test.ts`, `fmt.test.ts`.

## Gotchas

- **The first word decides a line, in context.** Section keywords are reserved; inside an item section any other word is an item name. `state` is ambiguous: `state hover=8` is the section, `state disabled opacity=0.3` (a bare word next) under a component is a child.
- **No cascades.** Lines under an unknown section are skipped; a role that failed to resolve is in `failed` and skipped by contrast; component variants that repeat a core role pair aren't re-reported. Keep it that way: echoes cost the model a repair round.
- **Comments are whole lines.** `#` starts a comment only at the start of a line; `#hex` and `#hex/alpha` are values; any other `#word` after content is an error.
- **Use `Object.hasOwn`** for catalog lookups (`"constructor" in COMPONENTS` is true).
- **Relative imports end in `.js`**, as in tsquare and beatsheet.
- Contrast numbers print truncated to one decimal (4.49 shows as 4.4, never rounds up to a false pass).

## Next

Milestone 2: the SVG style guide (`crayonbox render`), one tall board in the guide's order, drawn from `Style`. Open rendering questions are in `ROADMAP.md` (do/don't layout, licensed fonts).
