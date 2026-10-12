# crayonbox roadmap

Things we agreed to come back to. Decisions themselves go in the language guide's decision log (once it exists).

## Parked

- **Brand inheritance.** Two brands are two files (agreed 2026-10-11). How a brand builds on a base file (`extends=acme.crayon`? what can it override? DTCG `$extends` deep-merge semantics?) is still open.
- **A second mode axis.** v0.1 has one axis; high contrast is written as named modes (`light-hc`, `dark-hc`) that take their values from `light`/`dark` and override what changes. Revisit if density or other runtime axes make the combinations multiply.
- **Component catalog review.** v0.1 starts with button, input, card, badge, list item, tabs, checkbox, radio, switch. Look further at what's missing (select, dialog, toast, tab bar, nav bar, …), each component's anatomy, and which props each one takes.
- **Custom components** (outside the catalog, e.g. a pricing tile): not in v0.1, since we couldn't draw them. Revisit with the catalog review.
- **Licensed fonts in the guide.** v0.1 fetches Google Fonts by name and draws anything else (SF Pro, commercial fonts) with a labeled stand-in. Figure out how to render with fonts the user is licensed for: a local font file passed to `render`? A font URL in the file? What the license allows when the SVG embeds the font.
- **More checked rules.** v0.1 keeps only rules that check measurable quality in the file: contrast, min-text, touch (agreed 2026-10-11). Taste is guidance (`about=`, `do`, `dont`).

## Open questions for the rendering side

- **How to render `do` / `dont` lines.** A section can have any number of each (agreed 2026-10-11). In the SVG guide: two columns per section? A Do/Don't block at the end like DESIGN.md? Paired with a drawn example (a wrong and a right button)? What when there are many, or only dont's?

## Outputs (agreed direction, order not final)

1. `check`
2. CSS custom properties, Tailwind v4 `@theme`
3. DTCG `tokens.json` (lossless)
4. `DESIGN.md`
5. SVG style guide (specimen board)
6. SwiftUI, Jetpack Compose

## Later ideas

- `crayonbox audit src/`: check code built from the style against it: hard-coded colors, off-scale spacing, and the taste rules taken out of v0.1 because in the file they only catch the author contradicting themselves: `primary-only` (primary only on these components) and `max-weight` (no type heavier than this). `reduced-motion` was dropped outright: motion always has a reduced setting, so it could never fail.
- Skinning tsquare wireframes with a style file. Touches tsquare's "grayscale, exactly four color props" decision; needs the user's sign-off there.
- APCA contrast alongside WCAG 2.

## Out (for now)

- Layers / z-index: fails the "can it be drawn" test; an implementation detail.
