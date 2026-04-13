import packageJson from '../../package.json';

export const EXTENSION_ID = 'astahmer.jj-range-diff';
export const HELPER_COMMAND = 'jj-range-diff.openRangeMultiDiff';
export const OPEN_FILE_TIMELINE_COMMAND = 'jj-range-diff.openFileRevisionTimeline';
export const GET_TIMELINE_DEBUG_STATE_COMMAND = 'jj-range-diff._debug.getTimelineState';
export const OPEN_RANGE_DIFF_URI_PATH = '/open-range-multi-diff';
export const OPEN_MULTI_DIFF_COMMAND = '_workbench.openMultiDiffEditor';
export const SNAPSHOT_SCHEME = 'jj-range-diff';
export const PENDING_RANGE_DIFF_KEY = 'pendingRangeDiffArgs';
export const TIMELINE_PREFERENCES_KEY = 'timelinePanelPreferences';
export const CLI_SOURCE = 'cli';
export const DEFAULT_FROM_REVSET = 'closest_bookmark(@)';
export const DEFAULT_TO_REVSET = '@';
export const MAX_TIMELINE_ENTRIES = 200;
export const MAX_SNAPSHOT_HYDRATION_CHANGES = 8;
export const EXTENSION_VERSION = packageJson.version;

export const TIMELINE_PRESET_DAYS = {
	year: 365,
	'7d': 7,
	'30d': 30,
	'90d': 90,
	all: Number.POSITIVE_INFINITY,
} as const;
