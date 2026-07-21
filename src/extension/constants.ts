export const EXTENSION_ID = 'astahmer.jj-range-diff';
export const HELPER_COMMAND = 'jj-range-diff.openRangeMultiDiff';
export const OPEN_FILE_RANGE_DIFF_COMMAND = 'jj-range-diff.openFileRangeDiff';
export const OPEN_FILE_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
export const OPEN_FILE_LINE_TIMELINE_COMMAND = 'jj-range-diff.openFileLineTimeline';
export const OPEN_TIMELINE_AT_LINE_COMMAND = 'jj-range-diff.openTimelineAtLine';
export const OPEN_CHANGES_WITH_PREVIOUS_COMMAND = 'jj-range-diff.openChangesWithPrevious';
export const CLEAR_LINE_HISTORY_COMMAND = 'jj-range-diff.clearLineHistory';
export const GET_TIMELINE_DEBUG_STATE_COMMAND = 'jj-range-diff._debug.getTimelineState';
export const GET_DIFF_LAYOUT_METRICS_COMMAND = 'jj-range-diff._debug.getDiffLayoutMetrics';
export const DEBUG_SELECT_TIMELINE_RANGE_COMMAND = 'jj-range-diff._debug.selectTimelineRange';
export const DEBUG_SET_LAYOUT_MODE_COMMAND = 'jj-range-diff._debug.setLayoutMode';
export const OPEN_RANGE_DIFF_URI_PATH = '/open-range-multi-diff';
export const OPEN_MULTI_DIFF_COMMAND = '_workbench.openMultiDiffEditor';
export const SNAPSHOT_SCHEME = 'jj-range-diff';
export const PENDING_RANGE_DIFF_KEY = 'pendingRangeDiffArgs';
export const TIMELINE_PREFERENCES_KEY = 'timelinePanelPreferences';
export const CLI_SOURCE = 'cli';
export const DEFAULT_FROM_REVSET = 'closest_bookmark(@)';
export const DEFAULT_TO_REVSET = '@';
/** First-paint history depth — keep cold open snappy; expand later if truncated. */
export const INITIAL_TIMELINE_ENTRIES = 50;
/** Cap for full history / intermediate-revision fetches. */
export const MAX_TIMELINE_ENTRIES = 200;
export const MAX_SNAPSHOT_HYDRATION_CHANGES = 8;
/** Shared limit for concurrent `jj` / `git` spawns (avoids EAGAIN thrash). */
export const COMMAND_CONCURRENCY_LIMIT = 6;

export const TIMELINE_PRESET_DAYS = {
	year: 365,
	'7d': 7,
	'30d': 30,
	'90d': 90,
	all: Number.POSITIVE_INFINITY,
} as const;
