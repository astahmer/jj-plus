# JJ Plus webview UI/UX review

Status: review captured 2026-08-28. This document is intentionally separate from the Marketplace README; it is a product backlog and not a promise that every item ships in one release.

## Scope and evidence

The review covers the revision timeline webview, the standalone browser shell, line-history entry points, and the supplied reference screenshots. The current implementation was inspected in `webview/src/view/`, `webview/src/domain/`, and `webview/timeline.css`; the existing story, scene, and Playwright specs were used to distinguish current behavior from future ideas.

The strongest product signal from the screenshots is that the timeline can become a serious history workspace: a revision list, a clear range header, a scrubber, and a focused diff work well together. The current extension already has those primitives, but several states are still optimized for internal feature coverage rather than first-use comprehension.

## P0 — fix before broad adoption

### Make the first screen explain the next action

The timeline header exposes a lot of state, but a new user can still land on a dense panel without knowing whether to click a revision, drag the range, or open a diff. Add a short contextual instruction in the empty/loading state and replace it once the first selection is made. The instruction should name the current file and the active comparison mode, not describe implementation details.

Acceptance criteria:

- An empty, loading, error, and ready state are visually distinct.
- Each state has one primary next action.
- The first-use instruction disappears after a successful selection and can be rediscovered from Help.

Relevant areas: `webview/src/view/session-loading.ts`, `webview/src/view/timeline-pane.ts`, and the session/error branches in `webview/src/update.ts`.

### Make failure recovery actionable

Missing `jj`, missing `git`, an unopened workspace, unsupported files, and a failed diff currently need to be inferred from generic status or output-channel messages. Errors should say what was attempted, why it failed, and provide a button for the next safe action: retry, open output, switch backend, or open the workspace.

Acceptance criteria:

- Errors never leave an empty diff pane with no explanation.
- `jj`-specific errors mention that Git fallback is available when it is.
- Long command output remains in the output channel, while the webview shows a concise summary.

Relevant areas: `webview/src/view/session-loading.ts`, `src/extension/timeline-service.ts`, and `src/extension/command-runner.ts`.

## P1 — high-value workflow improvements

### Clarify comparison semantics

The panel supports range, single-revision, revision, snapshot, working-tree, line-history, and range-stack states. These are powerful but easy to confuse because the visible controls change meaning with the mode. Show a compact “Comparing X → Y” summary next to the active mode, and put the source of truth in the same place every time.

The labels should answer three questions without opening a menu:

1. Which revision is the left side?
2. Which revision is the right side?
3. Is the right side a commit, the working tree, or an operation snapshot?

Relevant areas: `webview/src/view/timeline-pane.ts`, `webview/src/view/timeline-controls.ts`, and `webview/src/view/timeline-revision-pickers.ts`.

### Improve revision-row scanability

Rows currently mix identifiers, markers, dates, authors, descriptions, action buttons, and diff statistics. Give the eye a stable order: identity and state first, description second, author/time third, actions last. Keep intermediate revisions visually quieter but do not make them look disabled. Use a consistent badge vocabulary for `FROM`, `TO`, `WORKING TREE`, `INTRODUCED`, `OTHER`, and operation entries.

Add an explicit selected state to the row that currently drives the diff. The `FROM` and `TO` anchors are not the same thing as the currently previewed revision, so they should not share one visual treatment.

Relevant areas: `webview/src/view/sidebar.ts` and the `.history-*` rules in `webview/timeline.css`.

### Make the timeline scrubber usable without precision dragging

The scrubber is a good overview, but tiny anchors are difficult to target in a narrow panel and dragging does not communicate whether it changes one anchor or the whole range. Add larger hit areas, a visible keyboard focus state, and adjacent previous/next controls. Keep the exact revision and date in the hover/focus card. On touch-sized surfaces, target at least 32–40px without making the visual marker itself huge.

Relevant areas: `webview/src/view/timeline-track.ts`, `webview/src/domain/timeline-tooltips.ts`, and the timeline marker styles.

### Replace tooltip repetition with a compact information card

The timeline range tooltip currently shows two metadata rows and two full descriptions. That is useful for debugging but expensive to scan. Prefer a compact card with a single range title, one line per endpoint, a change count, and a concise description preview. Truncate long descriptions with a title/accessible full value and do not repeat values that are already in the header.

The native editor blame hover had the same problem: it used a designed summary followed by the same raw metadata again. That duplication is now removed in the extension-side hover renderer.

Relevant areas: `webview/src/view/tooltip.ts` and `src/extension/timeline-at-line.ts`.

### Give the file switcher a stronger mental model

“All files in revision” and “Changed files” are useful modes, but the current controls make the distinction easy to miss. Add a short mode description and show the active file path as a persistent heading. For the changed-file list, show a count and the number of touched revisions; for the full list, show the selected revision identity.

When a range has more files than fit in the chip row, make the overflow discoverable rather than silently stopping at 16 entries.

Relevant areas: `webview/src/view/timeline-pane.ts`, file-switcher selectors, and the range-file-list styles.

### Make actions progressive but visible

The panel has many secondary actions: remote links, stack diffs, revset editing, snapshots, hotkeys, preferences, and output/retry actions. Keep the main path prominent, but group secondary actions behind a clearly labelled “More” menu with short descriptions. Avoid icon-only actions unless the tooltip also states the verb and target.

Relevant areas: `webview/src/view/timeline-controls.ts`, `webview/src/view/hotkeys.ts`, and `webview/src/view/floating-combobox-menus.ts`.

## P1 — accessibility and interaction quality

### Complete keyboard parity

Focusable revision rows need Enter/Space activation, visible focus rings, and predictable arrow-key navigation. The selected range should remain understandable without color alone. The timeline anchors, file switcher, menus, and diff controls need the same keyboard contract.

Add screen-reader labels that include the revision identity, date, author, touched-file status, and whether the entry is `FROM` or `TO`. Ensure nested row buttons do not trigger the row selection twice.

Relevant areas: `webview/src/view/sidebar.ts`, `webview/src/view/timeline-track.ts`, and existing shortcut tests.

### Respect reduced motion and contrast preferences

The layout uses transitions for the workspace and panels. Add `prefers-reduced-motion: reduce` to disable nonessential motion. Validate muted text, selected-range backgrounds, added/deleted colors, and intermediate-revision opacity against both VS Code themes and the standalone light/dark fallback themes.

Relevant area: `webview/timeline.css`.

### Announce asynchronous work

Loading indicators should expose a polite live status such as “Loading file history” or “Computing diff preview.” Completion and failure should update the same status region without stealing focus. Do not rely only on spinner appearance or changing button text.

Relevant areas: `webview/src/view/session-loading.ts`, `webview/src/model.ts`, and `webview/src/update.ts`.

## P2 — polish and resilience

## Editor blame popover review

The supplied screenshot exposed a separate editor-host issue: the same blame card was being offered by both the inline decoration and the hover provider, so VS Code stacked two identical popovers. The decoration now defers to the provider when the timeline-link setting is enabled, leaving one source of truth.

Remaining blame UX improvements, in priority order:

- Keep one compact card: line number and short revision in the title, author/date on one metadata row, and the summary as the only body copy. Avoid repeating `Author`, `Date`, `Revision`, and `Summary` labels after already-designed metadata.
- Make the primary action explicit: `Open revision timeline at line N` should be the only prominent action; add copy-revision and open-remote actions only when their targets are available.
- Distinguish current-line blame from sparse inline blame in copy. Current-line cards can say “Current line”; sparse entries should say “Changed here” or expose the hunk range so the user understands why this line was annotated.
- Make long summaries predictable. Clamp the decoration label, preserve the complete summary in the card, and expose the full revision id through a copy affordance or accessible title rather than widening the hover indefinitely.
- Handle missing or dirty working-tree data with context. If blame cannot resolve, say whether the file is unsaved, unsupported, or missing its VCS tool and offer a safe retry path.
- Remove duplicate interaction surfaces. Decorations, the registered hover provider, and CodeLens should not compete to open the same timeline; settings should define one visible entry point per mode.
- Verify keyboard and screen-reader behavior. The card should have a clear heading, a descriptive link name, no absolute-path leakage in visible copy, and a predictable dismissal path.
- Test narrow editors, long author names, long summaries, empty descriptions, binary files, renamed files, light/dark themes, and both `currentLineBlame` and `inlineBlameGutter` combinations.

### Improve responsive behavior

At narrow widths, the sidebar, timeline, path trail, endpoint pickers, and diff controls compete for horizontal space. Define explicit compact breakpoints: collapse the sidebar automatically only when the user has not manually chosen a width, move endpoint metadata under the title, and keep the primary diff action reachable without horizontal scrolling.

Test at narrow VS Code panels, a standalone browser window, zoom levels 125–200%, and a large system font. Keep the current focused-diff mode as an escape hatch.

### Handle long histories and large diffs deliberately

Large repositories need a visible history limit, incremental loading, and a clear “load older revisions” affordance. Long descriptions and deep paths should not make every row grow unpredictably. The diff should retain a loading skeleton while Pierre prepares a preview and should avoid re-rendering unrelated rows when only the selection changes.

Relevant areas: selectors, timeline model/cache code, `webview/src/pierre/`, and `src/extension/timeline-service.ts`.

### Improve search feedback

The search placeholder is powerful but not self-discovering. Add a small query syntax hint, show the number of matches and the active filter, preserve the query while switching file/mode, and provide a clear button. Invalid query syntax should be explained inline rather than looking like an empty history.

Relevant areas: `webview/src/view/sidebar.ts`, `webview/src/domain/sidebar-search.ts`, and the search story tests.

### Unify product language

The UI, commands, settings, output channel, and documentation currently mix the brand name `JJ Plus` with the internal prefix `jjplus`. Keep `JJ Plus` for user-facing titles and descriptions; keep `jjplus` only for stable configuration keys and command identifiers. Audit “revision,” “snapshot,” “operation,” “working tree,” “range,” and “single” so each term has one meaning.

### Make remote and operation context legible

Remote bookmarks, Git branches, JJ evolution entries, and operation entries should have distinct but restrained visual treatments. A user should be able to tell whether an identifier is a commit, change ID, bookmark, branch, or operation without memorizing abbreviations.

### Add privacy boundaries to the UI

The extension necessarily sends local paths and revsets to local VCS processes. The standalone server also exposes a local HTTP endpoint. Add a short “local only” note in Help/troubleshooting and ensure errors, telemetry-free logs, and copied links do not accidentally expose more absolute path information than necessary.

## Suggested delivery order

1. Ship the current blame-hover cleanup, Marketplace onboarding, and the P0 loading/error copy.
2. Establish selected-row, range-endpoint, and comparison-source visual contracts.
3. Add keyboard parity, screen-reader announcements, reduced motion, and responsive breakpoint tests.
4. Refine the timeline tooltip, file switcher overflow, and secondary-action menu.
5. Benchmark long histories and large diffs, then add incremental loading or virtualization only where measurements justify it.

## Test matrix to add

- Ready, empty, loading, retryable error, and missing-tool states.
- JJ, Git, working tree, snapshot, operation, and remote-backed entries.
- Keyboard-only selection, range selection, menus, comboboxes, and focus restoration.
- Narrow panel, wide panel, 125%/200% zoom, light theme, dark theme, and reduced motion.
- Long descriptions, deep paths, duplicate summaries, empty descriptions, and 1000+ history entries.
- Screen-reader snapshots for the timeline header, selected range, revision row, file switcher, tooltip, and error status.
