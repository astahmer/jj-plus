- refactor with Effect (proper interupts etc; cleaner jj/git adapters with context tags etc)
- lets find a better name for this extension & rename it everywhere
- use ark-ui for the webview combobox/tooltip..

## Future Ideas

- Expose a machine-readable CLI output mode for scripts that want timeline metadata without opening a UI.
- Inline multi-file diffs via Pierre `CodeView` (timeline is single-file for now; VS Code multi-diff stays for open-in-editor).

- when opening a file's timeline we should always open it from the newest revision. never in the middle of the timeline.
- seems like there's some layout shift happening while the diffs are loading.
- when opening the timeline; there's a loading state but no progress indication. so it can last for a while and there's no feedback for the user.
- is there anything we can do to make the timeline more responsive initially? or like overall; can we improve the speed of jj fetching? with patterns or just by maybe not re-using the CLI? is there some kind of lib we could use to get the same result but with better performance?
