---
name: foldkit
description: >
  Foldkit TEA patterns for this webview app. Use when editing webview/src (update, view,
  machine, messages), importing foldkit, or adding Machine.define / evo / Html. Points at
  ~/.references/foldkit and documents local session/selection/overlay machines plus Pierre
  portal constraints.
---

# Foldkit (visualjj-range-diff-helper)

Foldkit is the Elm-shaped TypeScript framework this webview uses (Effect + unidirectional update/view). Prefer framework primitives over inventing React-like patterns.

## Where to look

Canonical Foldkit source and examples live at the **global reference clone**, not a vendored `repos/foldkit/` subtree:

| Path                              | Use                                           |
| --------------------------------- | --------------------------------------------- |
| `~/.references/foldkit`           | Framework source, examples, CLAUDE.md, skills |
| `~/.references/foldkit/examples/` | Precedent apps by complexity                  |
| `~/.references/foldkit/packages/` | Library APIs                                  |
| `reference-repos.md` (repo root)  | How this project tracks the clone             |

List directories rather than trusting memorized nested paths — they drift.

Upstream skill (vendored-subtree wording): `~/.references/foldkit/skills/foldkit/SKILL.md`. This file adapts it for **this** repo’s `~/.references` layout.

## This app’s machines

Exclusive UI chrome and session/selection live under `webview/src/machine/`:

| Machine   | File           | Role                                                                |
| --------- | -------------- | ------------------------------------------------------------------- |
| Session   | `session.ts`   | Idle → Loading → Ready / Failed                                     |
| Selection | `selection.ts` | IdlePick → PendingAnchor → RangeSelected                            |
| Overlay   | `overlay.ts`   | Closed \| Hotkeys \| ViewMenu \| ActionsMenu (mutually exclusive)   |
| Drag      | `drag.ts`      | Track drag intents (not a full Machine rewrite target for overlays) |

Wire transitions through helpers in `webview/src/update.ts`:

- `stepSession` / `stepSelection` / `stepOverlay` — same pattern: `machine.transition` then `evo` the model field.
- Overlay also **syncs** `hotkeysOpen` / `viewMenuOpen` / `actionsMenuOpen` from state so views/subscriptions stay boolean-shaped.
- Opening a chrome overlay dismisses open comboboxes; `ClosedOverlays` clears menus **and** `openComboboxId`.

Prefer `Machine.define` when:

- States are exclusive tags with a small message set
- Illegal transitions should be impossible (e.g. two menus open)
- You already have session/selection as the house style

Keep plain booleans / `evo` for independent prefs (sidebar width, layout mode) that are not a statechart.

## Pierre portal vs Foldkit DOM

Diff rendering uses Pierre (`webview/src/pierre/`) mounted in a **portal outside** Foldkit’s Html tree. Consequences:

- Do not assume Foldkit `h.*` owns scroll/layout inside the portal — bridge metrics and host DOM repairs live in Pierre host code.
- Overlay chrome (view menu, hotkeys, track tooltip) should mount as **fixed** siblings at the Foldkit app root so overflowing panel ancestors cannot clip them — see `view/overlay-geometry.ts` and `view/tooltip.ts`.
- Imperative DOM fixes in the portal are OK; do not push Pierre layout into Foldkit Submodels.

## House rules (short)

- Unidirectional: Message → `update` → Model + Commands. No side effects in view.
- `evo` setters: pass the field transformer when it only transforms that field; use `() => value` for replacements from messages/other fields.
- Before adding a library, check Foldkit + Effect first (`~/.references/foldkit`).
- Pattern-match local `webview/src` first; fall back to `~/.references/foldkit/examples` when inventing a new seam.
