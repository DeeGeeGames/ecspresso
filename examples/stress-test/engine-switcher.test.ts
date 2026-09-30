import { describe, expect, test } from 'bun:test';
import { createEngineSwitcher } from './engine-switcher';

describe('benchmark engine switching', () => {
	test('serializes overlapping requests and joins asynchronous teardown once', async () => {
		const events: string[] = [];
		const release = Promise.withResolvers<void>();
		const disposing = Promise.withResolvers<void>();
		const switcher = createEngineSwitcher<'a' | 'b' | 'c'>({
			async start(engine) {
				events.push(`start:${engine}`);
				return async function destroy() {
					events.push(`destroy:${engine}`);
					if (engine !== 'a') return;
					disposing.resolve();
					await release.promise;
				};
			},
			onActive() {},
			onError(error) { throw error; },
		});
		await switcher.switchTo('a');
		const next = switcher.switchTo('b');
		const last = switcher.switchTo('c');
		await disposing.promise;
		expect(events).toEqual(['start:a', 'destroy:a']);
		release.resolve();
		await Promise.all([next, last]);
		expect(events).toEqual(['start:a', 'destroy:a', 'start:b', 'destroy:b', 'start:c']);
	});

	test('restores the previous engine after failed startup and accepts later requests', async () => {
		const starts: string[] = [];
		const errors: unknown[] = [];
		const active: Array<string | null> = [];
		const switcher = createEngineSwitcher<'a' | 'broken' | 'b'>({
			async start(engine) {
				starts.push(engine);
				if (engine === 'broken') throw new Error('load failed');
				return function destroy() {};
			},
			onActive(engine) { active.push(engine); },
			onError(error) { errors.push(error); },
		});
		await switcher.switchTo('a');
		await switcher.switchTo('broken');
		expect(starts).toEqual(['a', 'broken', 'a']);
		expect(active.at(-1)).toBe('a');
		expect(errors).toHaveLength(1);
		await switcher.switchTo('b');
		expect(active.at(-1)).toBe('b');
	});
});
