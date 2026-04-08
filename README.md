# JJ Range Diff

Minimal VS Code extension that opens JJ range multi-diff.

## Files

- `package.json`: VS Code extension manifest
- `extension.js`: runtime command implementation with `// @ts-check`

## Run Locally

1. Open this folder as a VS Code extension project, or add it to a multi-root workspace.
2. Press `F5` to launch an Extension Development Host.
3. Run `JJ: Open Range Multi Diff` from the command palette.

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

`bin.js` opens the same flow from your shell by forwarding a deep link into VS Code.

CLI launches now skip the extension input prompts and open the diff directly. Add `--confirm` if you want the prompt flow before opening.

```sh
./bin.js -f closest_bookmark(@) -t @
./bin.js --from yvspkqrx --to mvvosnsv --title 'range diff'
./bin.js --confirm -f closest_bookmark(@) -t @
./bin.js --ide cursor -f closest_bookmark(@) -t @
./bin.js --verbose --ide zed -f closest_bookmark(@) -t @
./bin.js -f closest_bookmark(@) -t @ -w /path/to/workspace
```

If you install the package with `npm link`, the `jj-range-diff` command is also available on your `PATH`.

`--ide` accepts known presets like `code`, `code-insiders`, `cursor`, `cursor-insiders`, `zed`, `windsurf`, and `codium`. You can also set `JJ_RANGE_DIFF_IDE` to change the default launcher.

## Logs

The extension writes the exact `jj` commands it runs to the `JJ Range Diff` output channel in VS Code. When you run the CLI with `--verbose`, the CLI also logs the IDE/open-url commands it used and opens that output channel so you can see the `jj` commands immediately.

## Install

```sh
cd /Users/astahmer/dev/work-related/welii/tools/jj-range-diff
npx @vscode/vsce package
```

Then install the generated `.vsix` file in your VS Code instance.
