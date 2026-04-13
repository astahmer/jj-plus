# JJ Range Diff

Minimal VS Code extension that opens JJ range multi-diff.

It also includes a custom revision timeline panel for the active file. The panel uses a scrubber-style timeline to move through revisions quickly and opens a diff against the previous revision as you select entries.

## Files

- `package.json`: VS Code extension manifest and workspace scripts
- `src/extension/`: VS Code entrypoint, timeline controller, and history adapters
- `src/bin.ts`: CLI entrypoint for deep links and the standalone timeline
- `src/shared/`: diff helpers, history parsing, and shared timeline contracts
- `webview/src/`: SolidJS webview source

## Run Locally

1. Open this folder as a VS Code extension project, or add it to a multi-root workspace.
2. Press `F5` to launch an Extension Development Host.
3. Run `JJ: Open Range Multi Diff` from the command palette.
4. Open a file and run `JJ: Open File Revision Timeline`.

For the Vite-powered webview shell during UI work:

```sh
pnpm install
pnpm fixtures:e2e
pnpm dev
```

The browser fixtures in `webview/public/e2e/` are generated artifacts now, so they should stay ignored and be regenerated with `pnpm fixtures:e2e` instead of being committed.

For typechecking and end-to-end coverage:

```sh
pnpm lint
pnpm typecheck
pnpm fixtures:e2e
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:all
```

`pnpm lint` now runs both `oxlint` and `knip`, and `pnpm typecheck` validates the Solid webview plus the TypeScript extension, CLI, and standalone server.

For production builds, compile the extension runtime and webview bundle:

```sh
pnpm build:extension
pnpm build:webview
```

`pnpm build` runs both builds and then packages the extension with `vsce`.

## Revision Timeline

`JJ: Open File Revision Timeline` opens a custom webview panel for the active file.

- Scrub across file revisions using the timeline slider
- Filter the visible window with `This month`, `Last 7D`, `30D`, `90D`, and `All`
- Open a diff between the selected revision and the previous revision
- Show the working tree as the latest stop on the timeline

The panel prefers JJ history when the workspace is a JJ repo and falls back to Git history otherwise, which makes it easy to iterate on the UI in a normal Git repository.

## Optional Programmatic Invocation

```js
await vscode.commands.executeCommand('jj-range-diff.openRangeMultiDiff', {
	workspacePath: '/Users/astahmer/dev/work-related/welii',
	from: 'yvspkqrx',
	to: 'mvvosnsv',
	title: 'yvspkqrx::mvvosnsv',
});
```

## CLI

The CLI supports two entry points now:

- the original deep-link flow into VS Code
- a standalone browser timeline for a single file

When running from this repository directly, build the extension runtime first:

```sh
pnpm build:extension
```

Then invoke the local binary with `pnpm exec jj-range-diff ...`. If you prefer, `node ./dist/bin.cjs ...` is equivalent against the built output.

### Range Diff Deep Link

`jj-range-diff` opens the same flow from your shell by forwarding a deep link into VS Code.

CLI launches now skip the extension input prompts and open the diff directly. Add `--confirm` if you want the prompt flow before opening.

```sh
pnpm exec jj-range-diff -f closest_bookmark(@) -t @
pnpm exec jj-range-diff --from yvspkqrx --to mvvosnsv --title 'range diff'
pnpm exec jj-range-diff --confirm -f closest_bookmark(@) -t @
pnpm exec jj-range-diff --ide cursor -f closest_bookmark(@) -t @
pnpm exec jj-range-diff --verbose --ide zed -f closest_bookmark(@) -t @
pnpm exec jj-range-diff -f closest_bookmark(@) -t @ -w /path/to/workspace
```

If you install the package with `npm link`, the `jj-range-diff` command is also available on your `PATH`.

`--ide` accepts known presets like `code`, `code-insiders`, `cursor`, `cursor-insiders`, `zed`, `windsurf`, and `codium`. You can also set `JJ_RANGE_DIFF_IDE` to change the default launcher.

### Standalone Timeline

The standalone timeline reuses the same webview UI in your default browser and serves it from a small local HTTP server. The command keeps running until you stop it.

```sh
pnpm build:extension
pnpm build:webview
pnpm exec jj-range-diff timeline README.md
pnpm exec jj-range-diff timeline --no-open --port 4173 README.md
pnpm exec jj-range-diff timeline -w /path/to/repo apps/backend/src/service.ts
```

With `npm link`, the same commands work through `jj-range-diff timeline ...`.

Use `--no-open` when you want to keep the server running without launching a browser automatically, and `--port` when you want a predictable local URL.

## Logs

The extension writes the exact `jj` commands it runs to the `JJ Range Diff` output channel in VS Code. When you run the CLI with `--verbose`, the CLI also logs the IDE/open-url commands it used and opens that output channel so you can see the `jj` commands immediately.

## Install

```sh
cd /Users/astahmer/dev/work-related/welii/tools/jj-range-diff
npx @vscode/vsce package
```

Then install the generated `.vsix` file in your VS Code instance.
