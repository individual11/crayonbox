# crayonbox

Style guides in plain text: easy for LLMs to write, checked before they ship. One file holds a whole style guide: colors with their modes, type, spacing, shape, elevation, motion, layout, icons and components. A checker tests contrast in every mode and tells you, line by line, what to fix.

```crayonbox
style "Field Notes" modes=light,dark
  about "A naturalist's field notebook: warm paper, graphite ink, one moss green for anything you can tap."

palette
  paper #F4F0E4
  ink   #1E1A14
  moss  #4F7A3A ramp

color
  background paper     dark=ink
  text       ink       dark=paper
  primary    moss-700  dark=moss-300

type ratio=1.25
  body 16 line=1.6

component button height=44 radius=md
  variant filled fill=primary
```

```bash
npm run check -- examples/field-notes.crayon
npm run render -- examples/field-notes.crayon -o guide.png
```

```text
Field Notes · 3 modes · 9 roles · 8 type styles · 2 components
contrast (AA, 4.5:1)  light     dark      dark-hc
  text/background     15.1 ✓    15.1 ✓    15.1 ✓
  …
auto     on-primary, on-danger, on-success, on-warning · type h1–h3, caption, code · ramps moss-50…950, …
default  roles success, warning · border · opacity · levels raised, floating, modal · easings · layout · icons · focus ring · 7 components
```

`render` draws the whole guide as one SVG (or PNG): palette and roles in every mode with their contrast, type specimens in the style's own fonts, grids, spacing, elevation, shape, motion curves, icons, and every component in every state. See [examples/field-notes.png](examples/field-notes.png).

Status: early. The parser, checker, formatter and SVG guide work (milestones 1 and 2); the exports (CSS, Tailwind, DTCG `tokens.json`, DESIGN.md, SwiftUI, Compose) are next. The spec is the crayonbox language guide (draft v0.1).

Requires Node 20 or newer. MIT license.
