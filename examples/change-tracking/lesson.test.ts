import { expect, test } from 'bun:test';
import { createLesson } from './lesson';

test('a declared write reaches the immediate consumer, while no-op processing skips marking', async () => {
	const lesson = createLesson();
	expect(lesson.step(false)).toEqual({ value: 0, observedUpdates: 0 });
	expect(lesson.step(true)).toEqual({ value: 1, observedUpdates: 1 });
	expect(lesson.step(false)).toEqual({ value: 1, observedUpdates: 1 });
	expect(lesson.step(true)).toEqual({ value: 2, observedUpdates: 2 });
	await lesson.world.dispose();
});
