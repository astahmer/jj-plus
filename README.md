# VisualJJ Range Diff Helper

Minimal no-build VS Code extension that exposes the hidden VisualJJ range multi-diff command.

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

## Install

```sh
cd /Users/astahmer/dev/work-related/welii/tools/visualjj-range-diff-helper
npx @vscode/vsce package
```

Then install the generated `visualjj-range-diff-helper-0.0.1.vsix` file in your VS Code instance:
`code --install-extension visualjj-range-diff-helper-0.0.1.vsix`
