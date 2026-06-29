# ICML Materials Browser Design System

## 1. Atmosphere & Identity

A quiet research command center for scanning dense conference material. The signature is compact semantic structure: muted surfaces, small labels, and direct controls that help users compare papers without turning exploration into a marketing page.

Core principle: the same function must use the same UI and UX everywhere. Reuse the existing interaction pattern first; create a new pattern only when the function is genuinely different.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/primary | --surface | #ffffff | n/a | Main panels |
| Surface/page | --bg | #fbfbfa | n/a | App background and inset cards |
| Surface/secondary | --surface-2 | #f4f5f6 | n/a | Chips and subtle fills |
| Surface/tertiary | --surface-3 | #f7f8f9 | n/a | Nested controls |
| Text/primary | --text | #25282b | n/a | Titles and body |
| Text/secondary | --muted | #71777d | n/a | Supporting text |
| Text/tertiary | --muted-2 | #9aa0a6 | n/a | Labels and low emphasis |
| Border/default | --line | #ecedef | n/a | Control outlines |
| Border/subtle | --line-soft | #f1f2f4 | n/a | Soft dividers |
| Accent/primary | --accent | #6aa593 | n/a | Focus and active states |
| Accent/strong | --accent-strong | #4f8576 | n/a | Hover and emphasized links |
| Status/success | --good | #047857 | n/a | Positive status |
| Status/warning | --warn | #b45309 | n/a | Cautions |
| Status/error | --bad | #b91c1c | n/a | Errors |

### Rules

- Keep the UI light, low-contrast, and research-focused.
- Accent color is for interaction and semantic emphasis, not decoration.
- Prefer existing CSS custom properties over adding raw color values.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| H1 | 22px | 800 | 1 | 0 | App title |
| H2 | 19px | 800 | 1.3 | 0 | Panel titles |
| H3 | 18px | 800 | 1.35 | 0 | Detail card titles |
| Body | 14px | 400-750 | 1.4-1.6 | 0 | Default content |
| Body/sm | 12px | 600-800 | 1.25-1.5 | 0 | Dense controls and metadata |
| Caption | 10px | 850 | 1.3 | 0.05em | Uppercase semantic labels |

### Font Stack

- Primary: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Mono: system monospace only when needed by data/code content.

### Rules

- Dense panels use small type, but titles and controls must not clip.
- Letter spacing stays at 0 except uppercase metadata labels already in use.

## 4. Spacing & Layout

### Base Unit

All spacing derives from a base of 4px.

| Token | Value | Usage |
|-------|-------|-------|
| --space-1 | 4px | Tight inline gaps |
| --space-2 | 8px | List gaps and compact controls |
| --space-3 | 12px | Default panel rhythm |
| --space-4 | 16px | Header and card padding |
| --space-5 | 20px | Comfortable panel padding |
| --space-6 | 24px | App header gaps |
| --space-8 | 32px | Major groups |

### Grid

- Layout is panel-first, using CSS grid/flex with `min-width: 0` to prevent overflow.
- Fixed-format controls should have stable dimensions and no layout shift on hover.

### Rules

- Prefer multiples of 4px.
- Keep repeated paper cards scannable and compact.

## 5. Components

Component rule: same function, same UI/UX. Before adding a component or control style, check whether the app already has the same interaction elsewhere and reuse that structure, styling, labels, and state behavior.

### Selection Stat Block

- **Structure**: rounded inset block with a compact heading and optional nested controls.
- **Variants**: plain stats, sample controls, study disclosure.
- **Spacing**: 8-12px internal rhythm.
- **States**: hover/focus on interactive controls, clipped text avoided with wrapping.
- **Accessibility**: native controls where possible; focus states remain visible.
- **Motion**: no required motion.

### Disclosure Inside Selection Blocks

- **Structure**: use native `details.study-disclosure` with `summary.selection-block-head`; keep the title in the left column and controls in `.selection-sample-controls`.
- **Controls**: reuse the existing 26x24 selection control style for help (`?`) and disclosure (`+`/`-`) affordances.
- **Default State**: collapsed unless a user action creates visible result content that should remain open.
- **Accessibility**: help controls expose their explanation via `title` and `aria-label`; disclosure uses native keyboard and expanded-state behavior.
- **Rule**: do not invent a separate disclosure visual language inside selection blocks.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 100-150ms | ease-out | Button hover and focus |
| Standard | 200-300ms | ease-in-out | Panel state changes if animated |

### Rules

- Prefer native controls for disclosure and form behavior.
- Every clickable control has hover and focus-visible states.
- Do not animate layout-heavy properties.

## 7. Depth & Surface

### Strategy

Mixed, matching the existing app: soft tonal surfaces plus thin borders for actionable controls and subtle shadows only on elevated panels.

| Level | Value | Usage |
|-------|-------|-------|
| Subtle | 0 2px 8px rgb(40 45 50 / 0.04) | Resting panels |
| Elevated | 0 18px 48px rgb(40 45 50 / 0.14) | Overlays |
