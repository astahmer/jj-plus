import { render } from 'solid-js/web';
import { App } from './app.tsx';
import '../timeline.css';

const root = document.getElementById('timelineApp');

if (root) {
	render(() => <App />, root);
}
