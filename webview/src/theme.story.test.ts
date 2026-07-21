import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState } from './commands.ts';
import { SelectedThemePreference } from './messages.ts';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';

test('theme preference persists independently of vscode default auto', () => {
	const ready = hydratedModel();
	expect(ready.themePreference).toBe('auto');

	Story.story(
		update,
		Story.with(ready),
		Story.message(SelectedThemePreference({ value: 'light' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.themePreference).toBe('light');
		}),
		Story.message(SelectedThemePreference({ value: 'dark' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.themePreference).toBe('dark');
		}),
		Story.message(SelectedThemePreference({ value: 'auto' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.themePreference).toBe('auto');
		}),
	);
});
