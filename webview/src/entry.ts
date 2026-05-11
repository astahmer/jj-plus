import { Runtime } from 'foldkit';
import { init, update } from './update.ts';
import { Model } from './model.ts';
import { subscriptions } from './subscriptions.ts';
import { view } from './view/app.ts';

const container = document.getElementById('timelineApp');
if (!container) {
	throw new Error('Missing #timelineApp container');
}

const program = Runtime.makeElement({
	Model,
	init,
	update,
	view,
	subscriptions,
	container,
});

Runtime.run(program);
