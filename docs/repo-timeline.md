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
- changed-file summary and a readable patch viewer;
- remote commit links when the repository has a supported `origin` URL;
- refresh, oldest/newest ordering, loading, and actionable error states.

The view is implemented as its own Foldkit entry point and panel. It does not
start a second server or embed `itwas web`; it calls the same extension-host
history adapters used by the file timeline.

## Deliberate boundaries

The first slice keeps the surface small enough to be useful without duplicating
the file timeline’s range-selection model. It currently does not include:

- changes-lane search for text introduced in patches;
- snapshot/content search;
- date and path filters;
- virtualized result rendering for repositories beyond the adapter limit;
- opening a selected file directly from the patch list.

These are follow-up slices, not hidden assumptions. The existing adapter now
has a repository revision-diff seam so these capabilities can be added without
changing the panel protocol.

## Interaction direction

The intended progression is:

1. Search or narrow with a revset.
2. Select a revision from the left rail.
3. Understand its author, refs, date, changed files, and patch.
4. Jump to the remote revision or use the file timeline for a deeper file-level investigation.

This keeps repository discovery and file archaeology as two related but
different jobs.
