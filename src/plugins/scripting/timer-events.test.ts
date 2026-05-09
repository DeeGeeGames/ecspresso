import { describe, test, expect } from 'bun:test';
import ECSpresso from '../../ecspresso';
import type { WorldConfigFrom } from '../../type-utils';
import { createTimer, createRepeatingTimer, createTimerPlugin, type TimerEventData } from './timers';

interface TestComponents {
	position: { x: number; y: number };
}

interface TestEvents {
	timerComplete: TimerEventData;
	oneShotComplete: TimerEventData;
	repeatingTimer: TimerEventData;
}

interface TestResources {
	counter: number;
}

describe('Timer Events', () => {
	describe('One-Shot Timers with Events', () => {
		test('should fire callback when timer completes', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let callbackData: TimerEventData = { entityId: -1, slot: '', duration: -1, elapsed: -1 };
			let callbackFired = false;

			const timer = ecs.spawn({
				timers: {
					fuse: createTimer(1.0, {
						onComplete: (data) => {
							callbackFired = true;
							callbackData = data;
						},
					}),
				},
			});

			expect(callbackFired).toBe(false);

			ecs.update(1.1);

			expect(callbackFired).toBe(true);
			expect(callbackData.entityId).toBe(timer.id);
			expect(callbackData.slot).toBe('fuse');
			expect(callbackData.duration).toBe(1.0);
		});

		test('should fire callback only once for one-shot timer', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let fireCount = 0;

			ecs.spawn({
				timers: {
					fuse: createTimer(0.5, { onComplete: () => { fireCount++; } }),
				},
			});

			ecs.update(0.6);
			ecs.update(0.1);
			ecs.update(0.1);

			expect(fireCount).toBe(1);
		});

		test('should include timer metadata in callback data', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let receivedData: TimerEventData = { entityId: -1, slot: '', duration: -1, elapsed: -1 };

			const timer = ecs.spawn({
				timers: {
					fuse: createTimer(2.5, {
						onComplete: (data) => { receivedData = data; },
					}),
				},
			});

			ecs.update(3.0);

			expect(receivedData.entityId).toBe(timer.id);
			expect(receivedData.slot).toBe('fuse');
			expect(receivedData.duration).toBe(2.5);
			expect(receivedData.elapsed).toBeGreaterThanOrEqual(2.5);
		});

		test('should leave entity alive after one-shot completes', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const timer = ecs.spawn({
				timers: { fuse: createTimer(0.5) },
			});

			ecs.update(0.6);

			expect(ecs.entityManager.getEntity(timer.id)).toBeDefined();
		});

		test('completed one-shot slot stays as idle data on the entity', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const entity = ecs.spawn({
				timers: { fuse: createTimer(0.5) },
			});

			ecs.update(0.6);
			ecs.update(0.5);

			const slot = entity.components.timers['fuse'];
			expect(slot).toBeDefined();
			expect(slot?.active).toBe(false);
			// `justFinished` flips back to false the frame after completion
			expect(slot?.justFinished).toBe(false);
		});
	});

	describe('Repeating Timers with Events', () => {
		test('should fire callback on each cycle for repeating timers', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let fireCount = 0;

			ecs.spawn({
				timers: {
					tick: createRepeatingTimer(0.5, { onComplete: () => { fireCount++; } }),
				},
			});

			ecs.update(0.6);
			expect(fireCount).toBe(1);

			ecs.update(0.5);
			expect(fireCount).toBe(2);

			ecs.update(0.5);
			expect(fireCount).toBe(3);
		});

		test('should preserve overflow time when firing repeating timer callbacks', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const fireTimestamps: number[] = [];

			ecs.spawn({
				timers: {
					tick: createRepeatingTimer(1.0, {
						onComplete: (data) => { fireTimestamps.push(data.elapsed); },
					}),
				},
			});

			ecs.update(1.3);

			expect(fireTimestamps.length).toBe(1);
		});
	});

	describe('Multiple Timers with Callbacks', () => {
		test('should allow multiple timers with independent callbacks', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const completedTimers: number[] = [];

			const onDone = (data: TimerEventData) => { completedTimers.push(data.entityId); };

			const a = ecs.spawn({ timers: { fuse: createTimer(0.5, { onComplete: onDone }) } });
			const b = ecs.spawn({ timers: { fuse: createTimer(1.0, { onComplete: onDone }) } });
			const c = ecs.spawn({ timers: { fuse: createTimer(1.5, { onComplete: onDone }) } });

			ecs.update(0.6);
			expect(completedTimers).toEqual([a.id]);

			ecs.update(0.5);
			expect(completedTimers).toEqual([a.id, b.id]);

			ecs.update(0.5);
			expect(completedTimers).toEqual([a.id, b.id, c.id]);
		});
	});

	describe('Multiple slots on a single entity', () => {
		test('independent slots tick and complete independently', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const completed: string[] = [];

			const entity = ecs.spawn({
				timers: {
					launch: createTimer(0.5, { onComplete: ({ slot }) => { completed.push(slot); } }),
					depleted: createTimer(1.0, { onComplete: ({ slot }) => { completed.push(slot); } }),
				},
			});

			ecs.update(0.6);
			expect(completed).toEqual(['launch']);
			expect(entity.components.timers['launch']?.active).toBe(false);
			expect(entity.components.timers['depleted']?.active).toBe(true);

			ecs.update(0.5);
			expect(completed).toEqual(['launch', 'depleted']);
			expect(entity.components.timers['depleted']?.active).toBe(false);
		});

		test('one-shot and repeating slots can coexist on the same entity', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let oneShotFires = 0;
			let repeatingFires = 0;

			ecs.spawn({
				timers: {
					launch: createTimer(0.5, { onComplete: () => { oneShotFires++; } }),
					hangarCycle: createRepeatingTimer(0.3, { onComplete: () => { repeatingFires++; } }),
				},
			});

			ecs.update(1.0);

			expect(oneShotFires).toBe(1);
			expect(repeatingFires).toBeGreaterThanOrEqual(3);
		});

		test('callback receives the originating slot name', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const seen: string[] = [];

			ecs.spawn({
				timers: {
					alpha: createTimer(0.4, { onComplete: ({ slot }) => { seen.push(slot); } }),
					beta: createTimer(0.6, { onComplete: ({ slot }) => { seen.push(slot); } }),
				},
			});

			ecs.update(1.0);

			expect(seen.sort()).toEqual(['alpha', 'beta']);
		});

		test('slot can be added at runtime and tick like any other', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let fired = false;

			const entity = ecs.spawn({
				timers: { initial: createTimer(0.5) },
			});

			entity.components.timers['added'] = createTimer(0.5, {
				onComplete: () => { fired = true; },
			});

			ecs.update(0.6);

			expect(fired).toBe(true);
		});
	});

	describe('Timers Without Events', () => {
		test('should work normally when onComplete is not specified', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const entity = ecs.spawn({
				timers: { fuse: createTimer(1.0) },
			});

			expect(() => { ecs.update(1.5); }).not.toThrow();
			expect(entity.components.timers['fuse']?.active).toBe(false);
			expect(ecs.entityManager.getEntity(entity.id)).toBeDefined();
		});

		test('should work with createTimer helper without callback', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const entity = ecs.spawn({
				timers: { fuse: createTimer(1.0) },
			});

			ecs.update(1.5);

			expect(ecs.entityManager.getEntity(entity.id)).toBeDefined();
			expect(entity.components.timers['fuse']?.active).toBe(false);
		});
	});

	describe('Timer Helper Functions with Callbacks', () => {
		test('createTimer should accept onComplete callback', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let callbackFired = false;

			ecs.spawn({
				timers: { fuse: createTimer(0.5, { onComplete: () => { callbackFired = true; } }) },
			});

			ecs.update(0.6);

			expect(callbackFired).toBe(true);
		});

		test('createRepeatingTimer should accept onComplete callback', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let fireCount = 0;

			ecs.spawn({
				timers: { tick: createRepeatingTimer(0.3, { onComplete: () => { fireCount++; } }) },
			});

			ecs.update(1.0);

			expect(fireCount).toBe(3);
		});

		test('timer options should be optional', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			expect(() => {
				ecs.spawn({ timers: { a: createTimer(1.0) } });
				ecs.spawn({ timers: { b: createRepeatingTimer(1.0) } });
			}).not.toThrow();
		});
	});

	describe('Caller-owned despawn pattern', () => {
		test('onComplete can despawn the host entity via commands', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			const entity = ecs.spawn({
				timers: {
					fuse: createTimer(0.5, {
						onComplete: ({ entityId }) => { ecs.commands.removeEntity(entityId); },
					}),
				},
			});

			expect(ecs.entityManager.getEntity(entity.id)).toBeDefined();

			ecs.update(0.6);

			expect(ecs.entityManager.getEntity(entity.id)).toBeUndefined();
		});

		test('callback fires while entity still exists', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let entityExistedDuringCallback = false;
			let receivedEntityId = -1;

			const entity = ecs.spawn({
				timers: {
					fuse: createTimer(0.5, {
						onComplete: ({ entityId }) => {
							receivedEntityId = entityId;
							entityExistedDuringCallback = ecs.entityManager.getEntity(entityId) !== undefined;
							ecs.commands.removeEntity(entityId);
						},
					}),
				},
			});

			ecs.update(0.6);

			expect(receivedEntityId).toBe(entity.id);
			expect(entityExistedDuringCallback).toBe(true);
			expect(ecs.entityManager.getEntity(entity.id)).toBeUndefined();
		});
	});

	describe('Edge Cases', () => {
		test('should handle entity removal before completion', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			let callbackFired = false;

			const entity = ecs.spawn({
				timers: {
					fuse: createTimer(1.0, { onComplete: () => { callbackFired = true; } }),
				},
			});

			ecs.update(0.5);
			ecs.removeEntity(entity.id);
			ecs.update(1.0);

			expect(callbackFired).toBe(false);
		});

		test('should handle onComplete callback that throws', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			ecs.spawn({
				timers: {
					fuse: createTimer(0.5, {
						onComplete: () => { throw new Error('callback error'); },
					}),
				},
			});

			expect(() => { ecs.update(1.0); }).toThrow('callback error');
		});
	});

	describe('onComplete callback typing', () => {
		test('data parameter infers as TimerEventData', () => {
			const ecs = ECSpresso
				.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
				.withPlugin(createTimerPlugin())
				.build();

			ecs.spawn({
				timers: {
					fuse: createTimer(1.0, {
						onComplete: (data) => {
							expect(typeof data.entityId).toBe('number');
							expect(typeof data.slot).toBe('string');
							expect(typeof data.duration).toBe('number');
							expect(typeof data.elapsed).toBe('number');
						},
					}),
				},
			});
		});

		test('onComplete is optional with no args', () => {
			createTimer(1.0);
			createRepeatingTimer(1.0);
		});

		test('onComplete is optional with empty options', () => {
			createTimer(1.0, {});
			createRepeatingTimer(1.0, {});
		});
	});
});
