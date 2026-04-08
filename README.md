# VisualJJ Range Diff Helper

Minimal no-build VS Code extension that opens JJ range multi-diff views directly from `jj`, without depending on the VisualJJ extension runtime.

## Files

- `package.json`: VS Code extension manifest
- `extension.js`: runtime command implementation with `// @ts-check`

## Run Locally

1. Open this folder as a VS Code extension project, or add it to a multi-root workspace.
2. Press `F5` to launch an Extension Development Host.
3. Run `VisualJJ: Open Range Multi Diff` from the command palette.

## Optional Programmatic Invocation

```js
await vscode.commands.executeCommand('visualjj.openRangeMultiDiff', {
	workspacePath: '/Users/astahmer/dev/work-related/welii',
	base: 'yvspkqrx',
	target: 'mvvosnsv',
	title: 'yvspkqrx::mvvosnsv',
});
```

## CLI

`bin.js` opens the same flow from your shell by forwarding a deep link into VS Code.

```sh
./bin.js -b branch_start(@) -t @
./bin.js --base yvspkqrx --target mvvosnsv --title 'range diff'
./bin.js -b branch_start(@) -t @ -w /path/to/workspace
```

If you install the package with `npm link`, the `visualjj-range-diff-helper` command is also available on your `PATH`.

## Install

```sh
cd /Users/astahmer/dev/work-related/welii/tools/visualjj-range-diff-helper
npx @vscode/vsce package
```

Then install the generated `.vsix` file in your VS Code instance.
