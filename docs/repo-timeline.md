# Repo Timeline

Repo Timeline is the repository-level companion to the file Revision Timeline.
It is designed for the question: “What happened in this repository, and where
should I look next?”

## Current slice

The `JJ Plus: Open Repo Timeline` command opens a sibling webview with:

- repository-wide revision history from JJ or Git;
- a JJ revset field, defaulting to `ancestors(@)`;
- local search across revision, change id, author, description, bookmarks, and branches;
- a revision list with working-copy-aware metadata and relative dates;
- a selected-revision detail pane;
- changed-file summary and Pierre-rendered, syntax-aware diffs;
- repository search across metadata, added patch lines, or a selected snapshot;
- literal, regular-expression, and fuzzy matching, plus path and date filters;
- remote commit links when the repository has a supported `origin` URL;
- refresh, oldest/newest ordering, loading, and actionable error states.

The view is implemented as its own Foldkit entry point and panel. It does not
start a second server or embed `itwas web`; it calls the same extension-host
history adapters used by the file timeline.

## Deliberate boundaries

The view intentionally does not duplicate every part of `itwas web`. The
current extension surface still does not include:

- `itwas`'s separate metadata/changes/snapshot lane layout and grouped
  cross-lane result table;
- related-change expansion and a dedicated “open file at result” action;
- shareable URL state and browser-style back/forward search state;
- column resizing, virtualization, and the richer large-result navigation;
- a user-facing theme switcher and the complete `itwas` keyboard shortcut set.

The extension does support the most important search primitives now, but the
search implementation is deliberately bounded to the adapter's 200 revision
history window and 500 returned matches. Very large repositories should get
lazy/concurrent search and virtualized rows before this becomes a full `itwas`
replacement.

## Interaction direction

The intended progression is:

1. Search or narrow with a revset.
2. Select a revision from the left rail.
3. Understand its author, refs, date, changed files, and patch.
4. Jump to the remote revision or use the file timeline for a deeper file-level investigation.

This keeps repository discovery and file archaeology as two related but
different jobs.
