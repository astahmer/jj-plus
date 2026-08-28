# JJ Plus

Minimal VS Code extension that opens JJ range multi-diff.

It also includes a custom revision timeline panel for the active file. The panel uses a scrubber-style timeline to move through revisions quickly and opens a diff against the previous revision as you select entries.

## Files

- `package.json`: VS Code extension manifest and workspace scripts
- `src/extension/`: VS Code entrypoint, timeline controller, and history adapters
- `src/bin.ts`: CLI entrypoint for deep links and the standalone timeline
- `src/shared/`: diff helpers, history parsing, and shared timeline contracts
- `tests/units/`: Node unit tests for CLI, shared helpers, and extracted webview logic
- `tests/features/`: Playwright browser specs plus BDD features, steps, and fixtures
- `tests/visual/`: Playwright screenshot baselines
- `tests/vscode/`: VS Code extension-host integration harness
- `tests/fixtures/`: generated browser fixture builder for end-to-end tests
- `webview/src/`: SolidJS webview source

## Run Locally

1. Open this folder as a VS Code / Cursor window (the extension project root).
2. Once: `pnpm seed:test-repo` (creates `test-repo/` with sample jj history).
3. Select launch config **Extension: test-repo**, then press `F5`.
   - `preLaunchTask` rebuilds `dist/` + `webview-dist/` so the host always loads the current sources.
   - `--extensionDevelopmentPath` loads this workspace; `--disable-extension=astahmer.jj-plus` blocks any installed VSIX of the same id.
4. In the Extension Development Host window, open a file under `test-repo/` and run `JJ: Open File Revision Timeline` (or `JJ: Open Range Multi Diff`).

For richer fixtures (same as e2e), run `pnpm fixtures:e2e` once, then F5 with **Extension: jj-basic fixture** or **Extension: git-basic fixture**.

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
`JJ: Open File Diff Between Revisions` prompts for `from` and `to` revisions, then opens a regular VS Code diff for just the active file.

- Scrub across file revisions using the timeline slider
- Filter the visible window with `This month`, `Last 7D`, `30D`, `90D`, and `All`
- Open a diff between the selected revision and the previous revision
- Show the working tree as the latest stop on the timeline

The panel prefers JJ history when the workspace is a JJ repo and falls back to Git history otherwise, which makes it easy to iterate on the UI in a normal Git repository.

## Optional Programmatic Invocation

```js
await vscode.commands.executeCommand('jj-plus.openRangeMultiDiff', {
	workspacePath: '/Users/astahmer/dev/work-related/welii',
	from: 'yvspkqrx',
	to: 'mvvosnsv',
	title: 'yvspkqrx::mvvosnsv',
});
```

## CLI

The CLI supports two flows:

- the deep-link range diff flow into VS Code, available both implicitly and as `diff`
- a standalone browser timeline for a single file

When running from this repository directly, build the extension runtime first:

```sh
pnpm build:extension
```

Then invoke the local binary with `pnpm exec jj-plus ...`. If you prefer, `node ./dist/bin.cjs ...` is equivalent against the built output.

### Range Diff Deep Link

`jj-plus` opens the same flow from your shell by forwarding a deep link into VS Code. `jj-plus diff` is the explicit equivalent, and that is the documented form below. The implicit default still works.

CLI launches now skip the extension input prompts and open the diff directly. Add `--confirm` if you want the prompt flow before opening.

```sh
pnpm exec jj-plus diff -f closest_bookmark(@) -t @
pnpm exec jj-plus diff --from yvspkqrx --to mvvosnsv --title 'range diff'
pnpm exec jj-plus diff --confirm -f closest_bookmark(@) -t @
pnpm exec jj-plus diff --ide cursor -f closest_bookmark(@) -t @
pnpm exec jj-plus diff --verbose --ide zed -f closest_bookmark(@) -t @
pnpm exec jj-plus diff -f closest_bookmark(@) -t @ -w /path/to/workspace
pnpm exec jj-plus -f closest_bookmark(@) -t @
```

If you install the package with `npm link`, the `jj-plus` command is also available on your `PATH`.

`--ide` accepts known presets like `code`, `code-insiders`, `cursor`, `cursor-insiders`, `zed`, `windsurf`, and `codium`. You can also set `JJ_PLUS_IDE` to change the default launcher.

### Standalone Timeline

The standalone timeline reuses the same webview UI in your default browser and serves it from a small local HTTP server. The command keeps running until you stop it.

```sh
pnpm build:extension
pnpm build:webview
pnpm exec jj-plus timeline README.md
pnpm exec jj-plus timeline --no-open --port 4173 README.md
pnpm exec jj-plus timeline -w /path/to/repo apps/backend/src/service.ts
```

With `npm link`, the same commands work through `jj-plus timeline ...`.

Use `--no-open` when you want to keep the server running without launching a browser automatically, and `--port` when you want a predictable local URL.

## Logs

The extension writes the exact `jj` commands it runs to the `JJ Plus` output channel in VS Code. When you run the CLI with `--verbose`, the CLI also logs the IDE/open-url commands it used and opens that output channel so you can see the `jj` commands immediately.

## Install

```sh
cd /Users/astahmer/dev/visualjj-range-diff-helper
npx @vscode/vsce package
```

Then install the generated `.vsix` file in your VS Code instance.
