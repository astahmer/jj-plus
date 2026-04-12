- fix the timeline vertical alignment with the arrow buttons
- the sidebar sort button should have a tooltip to explain what it does
- the sidebar items should have a "More" button to show the full revision description if its too long (we used to have this before the vite/solid migration)

- lets find a better name for this extension & rename it everywhere

## Future Ideas

- Persist standalone timeline state across server restarts, not just browser refreshes.
- Expose a machine-readable CLI output mode for scripts that want timeline metadata without opening a UI.
- Add timeline markers for bookmarks, branches, and JJ operations to make large histories easier to scan.
