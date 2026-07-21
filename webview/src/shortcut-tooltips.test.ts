import { describe, expect, test } from 'vitest';
import { shortcutTooltip } from './domain/timeline-shortcuts.ts';

describe('shortcut tooltips', () => {
	test('toggleable controls advertise their keys', () => {
		expect(shortcutTooltip('toggleSidebar')).toContain('(B)');
		expect(shortcutTooltip('toggleDiffFocus')).toContain('(D)');
		expect(shortcutTooltip('toggleHotkeys')).toContain('(?)');
		expect(shortcutTooltip('openSelectionDiffs')).toContain('(Space)');
	});
});
