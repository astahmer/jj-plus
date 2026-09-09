# JJ Plus

Explore Jujutsu and Git history without leaving your editor.

JJ Plus is a VS Code extension for comparing revisions, browsing the history of the active file, and jumping from a line directly to the revision that introduced it. It prefers Jujutsu when a workspace is managed by JJ and falls back to Git when it is not.

## What you can do

- Open a multi-file diff between two revisions, bookmarks, or revsets.
- Browse a file’s revision timeline with a compact history list, scrubber, and focused diff.
- Open a repository timeline to search and inspect revisions across the whole workspace.
- Compare a revision with its previous or next revision.
- Search history by author, description, or path.
- Inspect line blame and open the timeline at the current line.
- Review JJ evolution and operation history when working in a JJ repository.
- Use the same timeline from a terminal with the optional `jj-plus` CLI.

## Requirements

- VS Code 1.134 or newer.
- [Jujutsu](https://jj-vcs.github.io/jj/latest/install-and-setup/) for JJ history.
- Git is used automatically for ordinary Git workspaces.

## Install

Install **JJ Plus** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=astahmer.jj-plus), then reload VS Code if prompted.

Open the Command Palette and try:

- **JJ Plus: Open Revision Timeline** — browse the active file’s history.
- **JJ Plus: Open Repo Timeline** — search repository history and inspect any revision’s patch.
- **JJ Plus: Open Range Multi Diff** — compare two revisions across files.
- **JJ Plus: Toggle Line Blame** — show the revision behind the active line.

The extension reads repository history using the `jj` or `git` executable available on your PATH. It does not bundle either VCS or install a global terminal command.

## CLI (optional)

The Marketplace extension and the terminal CLI are separate installation channels. Installing the VSIX does not add `jj-plus` to your shell PATH.

Once the npm package is available, install the CLI separately:

```sh
npm install --global jj-plus
# or: pnpm add --global jj-plus
```

Then run a range diff or the standalone browser timeline from any repository:

```sh
jj-plus diff --from <revision> --to <revision>
jj-plus timeline path/to/file.ts
```

The CLI needs an installed VS Code-compatible IDE for deep-link diffs. It needs `jj` or `git` for the timeline, depending on the repository. Use `jj-plus --help` for all options, including `--ide`, `--workspace`, `--port`, `--no-open`, and `--verbose`.

## Useful workflows

### Timeline

Open **JJ Plus: Open Revision Timeline** with a file active. Select an entry to inspect its snapshot and use the comparison controls to switch between a single revision diff, a range, or the working tree. The file switcher can show all files in the selected revision or only files changed in the selected range.

Open **JJ Plus: Open Repo Timeline** when you are looking for a change across the repository. Search revision messages, authors, bookmarks, branches, and ids, then select a revision to inspect its changed files and patch. The Repo Timeline has its own view so repository discovery does not disturb the active file timeline.

### Line history

Enable **JJ Plus: Toggle Line Blame** or hover a line. The compact blame popover identifies the author, age, summary, revision, and line number, with one action to open the timeline at that line.

### Range diffs

The Command Palette command accepts the same revision language as JJ or Git. The CLI is useful for scripts and editor integrations:

```sh
jj-plus diff --from closest_bookmark(@) --to @ --workspace .
jj-plus diff --ide cursor --from <revision> --to <revision>
```

## Configuration

All settings are under `jjplus` in VS Code settings. The most useful ones are:

- `jjplus.currentLineBlame` — optionally annotate the active line in saved, clean files (off by default).
- `jjplus.inlineBlameGutter` — annotate revision hunk starts throughout the file.
- `jjplus.hoverTimelineLink` — offer a timeline link when hovering source lines.
- `jjplus.scmChangedLines` — show changes against the previous working-copy revision.
- `jjplus.conflictHelper` — highlight JJ conflict markers and enable next-conflict navigation.

## Troubleshooting

Open the **JJ Plus** output channel to see the exact `jj` or `git` commands used by the extension. For CLI diagnostics, add `--verbose`.

If history is unavailable, verify the repository is open as a VS Code workspace and that `jj --version` or `git --version` works in the same environment as VS Code.

Report problems or request features in the [GitHub issue tracker](https://github.com/astahmer/jj-plus/issues).

## Development

Contributor setup, test commands, fixture generation, and the release checklist live in [`docs/development.md`](docs/development.md). The user-facing Marketplace README intentionally stays short and task-oriented.

## License

The project is currently distributed without a declared open-source license. Check the repository for the latest licensing decision before redistributing it.
