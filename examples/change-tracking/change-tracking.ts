import { createLesson } from './lesson';

const value = document.querySelector('#value');
const updates = document.querySelector('#updates');
const status = document.querySelector('#status');
const write = document.querySelector('#write');
const noop = document.querySelector('#noop');

if (value && updates && status && write && noop) {
	const lesson = createLesson();
	const step = function(shouldWrite: boolean) {
		const result = lesson.step(shouldWrite);
		value.textContent = String(result.value);
		updates.textContent = String(result.observedUpdates);
		status.textContent = shouldWrite ? 'Wrote counter; changed consumer ran.' : 'No write; consumer skipped.';
	};
	write.addEventListener('click', () => step(true));
	noop.addEventListener('click', () => step(false));
}
