- refactor with Effect (proper interupts etc; cleaner jj/git adapters with context tags etc)
- lets find a better name for this extension & rename it everywhere
- use ark-ui for the webview combobox/tooltip..

## Future Ideas

- Expose a machine-readable CLI output mode for scripts that want timeline metadata without opening a UI.
- Inline multi-file diffs via Pierre `CodeView` (timeline is single-file for now; VS Code multi-diff stays for open-in-editor).

### jj-lib (in-process) — later performance path

**Why nice:** every `jj` call today pays process spawn + CLI parse + cold repo open. `jj-lib` (Rust crate behind the `jj` binary) can keep the repo/index warm in-process and answer log/diff/evolog without shelling out — big win for sidebar counts, rename walks, and snapshot hydrate.

**How we could incorporate:**

1. Ship a small **sidecar binary** (or napi addon) that links `jj-lib` and speaks a stable JSON/NDJSON protocol over stdio — _not_ embed native modules directly in the VS Code extension host if we can avoid Electron ABI hell.
2. Keep the existing `HistoryAdapter` / `CommandRunner` boundary; add a `JjLibRunner` that implements the same ops (`log`, `file show`, `diff`, `evolog`, `file list`).
3. Feature-detect: prefer sidecar when present + version-compatible with the user’s repo; fall back to CLI otherwise.
4. Caveats: `jj-lib` API is explicitly unstable; storage-format coupling means we must version-pin the sidecar to jj releases; upstream still wants a first-class `jj api`/daemon for IDEs ([jj#3219](https://github.com/jj-vcs/jj/issues/3219)) — prefer adopting that when it ships.

**Not doing for now:** long-lived `jj` CLI helper process (spawn once, reuse) — spawn tax is real but adapter/load-shape work (progressive paint, concurrency cap, lazy file list, smaller first log) is the better ROI first.

- is there anything else we can do to improve the webview styling/UX? better layout? something to make it look less vibecoded?
