# Layer 5 artifact style guide

## Source and inline kit

The approved Habits look is `docs/design/mockup-v1-habits/index.html` (`#view-habits`) and its supplied desktop/phone renders. The kit is `artifacts/kit/nova-kit.css` and `nova-kit.js`; copy both inline into the single artifact. Add exactly one optional font stylesheet link:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,460;9..144,560&family=Outfit:wght@340;460;560&family=Caveat:wght@500;700&display=swap">
```

Use the complete local stacks below so the page keeps its shape if the host blocks Google Fonts. Do not use other remote resources, `@import`, font files, or `<script src>`. Set `class="nova-artifact"` on the root. Let an explicit host theme win using `data-theme="light|dark"`; with no host value, system color preference is the fallback. `NovaKit.applyTheme(root, hostTheme, systemDark)` sets the resolved theme.

## Palette tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--nova-host` / `--nova-host-top` / `--nova-host-deep` | `#5B92E5` / `#8FBef0` / `#3A6EA5` | `#14213A` / `#1B2B47` / `#0D1730` | Layered page backdrop |
| `--nova-surface` | `#FFFCF7` | `#1C2535` | Warm cards |
| `--nova-surface-2` | `#F7F4EE` | `#252F41` | Table header and inset areas |
| `--nova-ink` | `#241C18` | `#F5F0E8` | Main text |
| `--nova-muted` | `#6E675F` | `#C8C1B7` | Secondary text |
| `--nova-line` / `--nova-line-strong` | `#DDD6C8` / `#928A7F` | `#465165` / `#8995A7` | Dividers / dashed states |
| `--nova-accent` / `--nova-accent-deep` | `#4A8C4E` / `#2F6B34` | `#8DC991` / `#9CDAA0` | Done mark / selected row and labels |
| `--nova-accent-tint` / `--nova-accent-ink` | `#F3F8F3` / `#245A2A` | `#25382C` / `#C3EDC5` | Status pill |
| `--nova-info` / `--nova-info-deep` | `#245EDC` / `#0A246A` | `#9EBEFF` / `#A9C5FF` | Selection/focus |
| `--nova-info-tint` | `#E8F0FB` | `#263754` | Information panel |
| `--nova-alert` / `--nova-alert-ink` / `--nova-alert-tint` | `#B5483E` / `#5C241E` / `#E7A8A2` | `#F0A39B` / `#FFE2DE` / `#633B3A` | Explicit miss/error |
| `--nova-partial` / `--nova-partial-ink` | `#F3D56A` / `#241C18` | `#F2D36C` / `#241C18` | Partial outcome |
| `--nova-notdue` / `--nova-notdue-ink` | `#E4E2DC` / `#514C45` | `#414955` / `#F1ECE2` | Not due only when a view establishes it |
| `--nova-voice` / `--nova-voice-ink` | `#0A246A` / `#F6F3EC` | `#091B4A` / `#FBF7EF` | Second Voice card |
| `--nova-voice-muted` / `--nova-voice-note` | `#A6CAF0` / `#D7F5DC` | `#B5D1FF` / `#C9F0CE` | Voice label / secondary note |

Use the derived dark theme as specified above; retain strong text contrast on every outcome. Do not communicate a status by color alone. The readable name/state remains in text/ARIA. The green done cell uses white only with the darker mockup green; for the reference `#4A8C4E` it is close to AA, so use `--nova-accent-deep` when a contrast check is below 4.5:1.

## Type and scale

| Role | Stack and use |
|---|---|
| Display | `Fraunces`, `Georgia`, `Times New Roman`, serif. H1 42 px / 0.98 line-height; calendar title 26/29; card title 22/26. Use weight 460. |
| UI | `Outfit`, `Segoe UI`, `system-ui`, `-apple-system`, `Helvetica Neue`, `Arial`, sans-serif. Body 16/24; lede 15/22; row 14/20; secondary 12/18. |
| Handwritten accent | `Caveat`, `Segoe Print`, `Bradley Hand`, cursive. Use sparingly for short annotations only; never for data or controls. |
| Technical evidence | `ui-monospace`, Cascadia Mono, Consolas, monospace; wrap IDs. |

Spacing values: 4, 8, 12, 16, 18, 22, and 32 px. Controls are pill-shaped or 12 px rounded; cards use 22 px radius and the warm navy-tinted shadow from the kit. Calendar cells use 8 px radius. Main width is fluid, capped at 1680 px.

## Components and interaction

- **Heading:** eyebrow, Fraunces title with green emphasis, and muted lede. Keep the voice of the source copy, while not turning illustrative claims into data claims.
- **Status pill:** green tint, dot plus text. Say “missed today” only when there is an explicit current-date `not_done`; with no report use “No report yet.”
- **Habit table:** Name, Type, Frequency, Streak. Selected row uses pale green background and 3 px inset green edge. Frequency and streak text remain visible when the viewport narrows. Null/unknown streak is “Unknown,” never 0.
- **Month calendar:** CSS grid starts Sunday. Use native buttons for dated cells, textual accessible labels, and a 44 px minimum target. `NovaKit.renderMonth` lays out a month Sunday-first; dates with no evidence are “No report,” future dates “Ahead.” Only explicit `done`, `partial`, and `not_done` map to Kept, Partial, and Missed. A declared pause has its own state and preserves, but does not extend, the streak. Do not infer “Not due” without recurrence evidence.
- **Outcome key:** show Kept, Partial, Missed, and No report. If the schedule view is missing, show “Not due unavailable” as an explanatory gap, not as a fabricated day state.
- **Second Voice:** dark navy card. Render only text supplied by a stored analysis and identify its source/date. With no stored analysis, hide the card or show neutral “No analysis yet.” Never reuse the mockup's canned judgment.
- **Step list:** done / not_done / unknown markers with the reported time/source in text. Missing timing or source stays “Not available”; a missing step report is unknown, not skipped. The routine list itself has a known-routine-ID gap; show an honest empty state until available.
- **Status, empty, error:** always include text. Errors use `NovaKit.safeMessage(code)`; never render raw tool `detail`.
- **Coverage:** show coverage beside every figure using its view's `cov_*`, date range and `basis`. Null means “Unknown” or “Not available,” not zero.
- **Focus and motion:** all interactive controls are at least 44 px. Visible focus outline is 3 px with 2 px offset. Disable transitions and animations for reduced motion. No fixed bottom action may cover page content.

Keep phone layout at or below 860 px to one column: table, calendar, voice card, and step card in that order. At wide widths, table/calendar share the main card and voice/steps occupy the side column. Never allow horizontal scrolling.
