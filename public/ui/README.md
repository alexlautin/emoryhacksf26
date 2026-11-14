# Harness brand & UI kit

Open `/ui/index.html` on either the local app server or website for the visual reference. It includes light, dark, high contrast, and compact/default/marketing component previews.

## Source of truth

Edit **the root `public/ui/` directory**. The website's `prepare.mjs` copies this directory into its ignored `public/ui/` before development and builds. Desktop staging includes the root `public/` directory and prepares the same assets for the native startup screen. Do not edit generated website copies. Run `node website/prepare.mjs` to refresh static kit assets during a running website preview.

| File | Responsibility |
| --- | --- |
| `tokens.css` | Brand palette, semantic themes, font, type scale, space, shape, motion, density defaults |
| `components.css` | Framework-free buttons, cards, fields, help, badges, alerts, brand lockup |
| `pug.png` | Canonical pug mark, used by both headers and the app favicon |
| `fonts/` | Locally served Instrument Sans variable font and OFL license |
| `index.html`, `kit.css`, `kit.js` | Visual reference; reference-specific styles and controls |

The landing site imports the prepared CSS through `website/src/site.css`. The plain HTML app imports it through `public/styles.css`. Both adapt existing token and class names to preserve their page structure. No component framework or build step is required by the app.

## Identity and voice

Harness is watchful, calm, and approachable. Use the pug with the Harness wordmark, in Instrument Sans 600–700. Keep clear space around the mark of at least one quarter of its width; use it at 32px or larger in headers. Preserve its proportions and colors. Use the original asset, not a newly drawn imitation. Native installer and tray icons retain their platform-specific exports; the tray's monochrome status glyph remains functional UI.

Explain what happened, why it matters, and what action is available. Use short, concrete language. Avoid unsupported safety promises. Keep commands and paths in monospace. Marketing headlines may be expressive; activity and alert text should be precise.

## Foundations

Use semantic variables in UI, rather than raw palette colors:

- Surfaces: `--h-bg`, `--h-surface`, `--h-surface-2`.
- Text: `--h-text`, `--h-muted`, `--h-subtle`.
- Borders: `--h-border`, `--h-border-strong`.
- Actions: `--h-action` with `--h-on-action`; links/focus use `--h-accent`.
- Status: `--h-success`, `--h-steady`, `--h-warning`, `--h-danger`, `--h-info`, `--h-paused`.
- Type: `--h-font`, `--h-mono`, `--h-type-xs` through `--h-type-xl`.
- Space: `--h-space-1` through `--h-space-8` (4, 8, 12, 16, 24, 32, 48, 64px).
- Shape: `--h-radius-sm` (6), `--h-radius-control` (8), `--h-radius-card` (16), `--h-radius-lg` (24), `--h-radius-pill`.
- Motion: `--h-duration` and `--h-ease`; honor `prefers-reduced-motion`.

Paper, ink, teal, and fawn are the core brand palette. Bright teal is for illustration/highlight; deep teal is for accessible light-background text and primary actions. Semantic colors adapt through `light-dark()`. Set `data-theme="light"` or `"dark"` on `<html>`; omit it to follow the system. The landing site intentionally defaults to light, with dark storytelling sections. The app keeps its saved theme and contrast preferences.

Use words with status colors: Clear, Steady, Review, Act. Paused is an operational state. Never imply that a score of 100 guarantees safety. Use visible labels, keyboard focus, associated error messages, and `disabled` on unavailable buttons. If using `aria-disabled` on a link, the caller must also prevent activation. Set `data-contrast="high"` on `<html>` for the high-contrast foundations.

## Components

The same HTML works in plain templates or React (use `className`).

```html
<button class="ui-button" data-variant="primary">Protect folder</button>
<button class="ui-button">Secondary action</button>
<button class="ui-button" data-variant="ghost">Cancel</button>
<button class="ui-button" data-variant="danger">End session</button>
<button class="ui-button" data-size="small" disabled>Unavailable</button>

<section class="ui-card">…</section>

<label class="ui-field">
  Project folder
  <input class="ui-input" aria-describedby="folder-help">
  <span class="ui-help" id="folder-help">Choose a folder on this computer.</span>
</label>

<span class="ui-badge" data-status="review">Review</span>
<div class="ui-alert" data-status="review">
  <strong>Review this connection.</strong> Check the server before continuing.
</div>
```

Supported `data-status` values: `clear`, `steady`, `review`, `act`, `paused`. Alerts are visual containers; add `role="status"` for dynamic polite updates only when appropriate. Keep destructive actions separate from the default action. Use one primary action per group.

Legacy button classes (`.btn`, `.primary`, `.danger`, `.ghost`, `.small`, `.icon`, `.btn-ink`, `.btn-line`, `.btn-primary`, `.btn-secondary`, `.btn-sm`) resolve to the shared implementation. New UI should use the explicit `ui-` primitives. Existing specialized controls (segments, switches, timeline, score, session rows, dialogs, menu panel) remain surface-owned and consume the shared foundations through their current aliases. Their interaction behavior stays in the existing app modules.

## Density and layout

Set only these density variables at a surface/container boundary:

| Surface | `--ui-control-height` | `--ui-control-padding` | `--ui-control-font` |
| --- | --- | --- | --- |
| App | 32px | 12px | 13px |
| Default | 40px | 16px | 15px |
| Landing | 50px | 22px | 16px |

App controls are compact for desktop pointer use; provide larger hit areas for any future touch-first surface. Keep page composition in `public/styles.css`, `website/src/site.css`, and `website/app/demo.css`. Use flexible grids and wrapping at narrow widths. Display headlines can scale fluidly; dense labels should remain legible.

Use Lucide for interface icons, normally 16–20px with a consistent stroke. The app's allowlist lives in `src/icons.js`. Agent vendor marks identify agents and should retain their original artwork. Mark decorative icons `aria-hidden="true"`; label icon-only controls.

## Making a change

1. For a global visual change, edit a semantic token. For shared component behavior, edit `components.css`. For composition or specialized controls, edit the owning surface stylesheet.
2. Update the reference and this guide when adding a reusable primitive or token.
3. Run `pnpm test`, then `cd website && pnpm test && pnpm build`.
4. Inspect the kit, landing, demo, and app at wide/narrow widths, in light/dark and high contrast. Check keyboard focus, disabled/error states, and reduced motion.

No new runtime dependencies are required. The font is served locally on both surfaces; no Google Fonts request is needed.
