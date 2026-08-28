import { Runtime } from 'foldkit';
import './styles.css';
import { init, update } from './update.ts';
import { Model } from './model.ts';
import { subscriptions } from './subscriptions.ts';
import { view } from './view.ts';

const container = document.getElementById('timelineApp');
if (!container) throw new Error('Missing #timelineApp container');
container.classList.add('repo-timeline-root');
document.body.classList.add('repo-timeline-body');

Runtime.run(
	Runtime.makeElement({
		Model,
		init,
		update,
		view,
		subscriptions,
		container,
	}),
);
