# File time-machine roadmap

Goal: be the **best file-centric time machine** for jj (git fallback) — scrub, range, and understand how one file (and related paths) evolved. Not a full SCM / commit-graph client.

Related: [TODO.md](./TODO.md) (engineering backlog). This doc is product ideas + priority.

## Sharp next bets (in progress)

| #   | Bet                                 | Intent                                                        | Status                        |
| --- | ----------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| 1   | **Line history + blame → timeline** | Selection / blame jumps to only revs that touched those lines | done                          |
| 2   | **Rename / copy follow (visible)**  | Adapter already follows paths; surface path trail + trust UX  | done                          |
| 3   | **Churn bars on track**             | Anchor height/color from +/- or hunk count so big edits pop   | done                          |
| 4   | **Multi-file Pierre for range**     | Inspect all files changed in from→to inside the panel         | done (chips + in-panel stack) |
| 5   | **Revset filter + evolog overlay**  | Power filter (`jj log -r`) + evolution strip for a change     | done                          |

## Wave 2 sharp bets

| #   | Bet                              | Intent                                                              | Status |
| --- | -------------------------------- | ------------------------------------------------------------------- | ------ |
| 6   | **Blame overlay on Pierre**      | Annotate after-side lines; click jumps timeline to that blame rev   | next   |
| 7   | **Search in history**            | Find when a string was introduced / last removed across file revs   | queued |
| 8   | **Time-lapse play**              | Auto-step the scrubber through the selected/visible range with pause | queued |

## Idea inventory (from competitors)

### Stay in lane (high fit)

- Line / selection history (GitLens, JetBrains)
- Blame overlay on Pierre → jump timeline to that rev
- Change-size / churn scrubber (GitLens Visual File History)
- Rename / copy chase across history (`--follow`, jj summary renames)
- Multi-file range diffs via Pierre CodeView (also in TODO)
- “Hot in range” — files ranked by churn in selected from→to (GitViz Hot Files, range-scoped)
- Search in history — string introduced / removed across revs
- Time-lapse play — auto-step range with pause (Perforce)
- Folder / glob timeline (not only one file)
- Deep-link + CLI JSON timeline metadata (TODO)
- Gutter / CodeLens “open timeline here”
- Compare two bookmarks / branches for one file in-panel
- Open file at revision (read-only buffer)
- Heatmap gutter for recent touch density
- Path breadcrumb when `filePath` changes across entries

### jj-native differentiators

- Evolog strip beside timeline (`jj evolog`)
- Op-log peek — “what did last ops do to this file?”
- Conflict / empty / immutable badges on stops (Open JJ / JJ View)
- Revset filter box + keep date presets for normals
- Color-words vs git diff toggle (lazyjj)
- Soft bridge: open selected change in Open JJ / JJ View (don’t rebuild SCM)

### Editor glue

- Command: open timeline for current selection / cursor line
- Status-bar chip when line-history filter active
- Preserve line filter across file switch only when path follows rename

### Explicitly out of scope (partner / skip)

- Full repo DAG + drag rebase / squash / abandon (Open JJ, JJ View, lazyjj)
- Staging / commit / push / PR workflow (SCM + Open JJ)
- Account-gated Pro graphs / telemetry (GitLens Pro)
- Replacing Git Graph / GitLens as general Git IDE suite

## Competitive map (short)

| Camp                 | Tools                                             | Their strength vs us                          |
| -------------------- | ------------------------------------------------- | --------------------------------------------- |
| Mainstream Git IDE   | GitLens, VS Code Timeline, Git Graph, Git History | Blame, DAG, line history, Visual File History |
| FOSS GitLens-ish     | GitViz, Minimal Git File History                  | Free blame + hot files + compare              |
| Classic GUIs         | GitKraken, Sublime Merge, Fork, Tower             | Full client                                   |
| JetBrains / Perforce | Local History, Time-lapse                         | File scrub + annotate                         |
| jj VS Code           | Open JJ, JJ View                                  | Repo log, mutate, workspaces, PR              |
| jj TUI               | lazyjj, jjui                                      | Revsets, op-log, absorb/split                 |
| Diff engines         | Pierre, GitHub PR, VS Code Multi Diff             | Multi-file review UX                          |

**We win today on:** range + step selection, snapshot vs revision, scrubber + in-panel Pierre, large wrap repair, jj-first file timeline.

## Verification bar for each bet

- Unit tests for pure domain / parsers
- Integration (VS Code host) where host commands or adapters matter
- Playwright / scene e2e for visible chrome
- One described `jj` change per bet (or split doc vs impl when useful)
