import { expect, describe, test } from 'bun:test';
import ECSpresso from './ecspresso';
import { definePlugin } from './plugin';
import type { WorldConfigFrom } from './type-utils';

interface TestComponents {
	position: { x: number; y: number };
	health: { value: number };
}

interface TestEvents {
	entityCreated: { entityId: number };
	entityDestroyed: { entityId: number };
	componentAdded: { entityId: number; componentName: string };
	componentRemoved: { entityId: number; componentName: string };
	collision: { entity1Id: number; entity2Id: number };
	healthChanged: { entityId: number; oldValue: number; newValue: number };
	gameStateChanged: { oldState: string; newState: string };
	playerDamaged: { entityId: number; amount: number };
}

describe('EventSystem', () => {
	test('should allow subscribing to and publishing events', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let receivedData: any = null;

		const unsubscribe = eventBus.subscribe('entityCreated', (data) => {
			receivedData = data;
		});

		eventBus.publish('entityCreated', { entityId: 1 });
		expect(receivedData).toEqual({ entityId: 1 });

		// Unsubscribe and verify it doesn't receive future events
		unsubscribe();
		eventBus.publish('entityCreated', { entityId: 2 });
		expect(receivedData).toEqual({ entityId: 1 }); // Should not be updated
	});

	test('should handle one-time event subscriptions', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let normalEventCount = 0;
		let onceEventCount = 0;

		eventBus.subscribe('entityCreated', () => {
			normalEventCount++;
		});

		eventBus.once('entityCreated', () => {
			onceEventCount++;
		});

		eventBus.publish('entityCreated', { entityId: 1 });
		eventBus.publish('entityCreated', { entityId: 2 });
		eventBus.publish('entityCreated', { entityId: 3 });

		expect(normalEventCount).toBe(3);
		expect(onceEventCount).toBe(1);
	});

	test('should handle unsubscribing from events', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let eventCount = 0;

		const unsubscribe = eventBus.subscribe('entityCreated', () => {
			eventCount++;
		});

		eventBus.publish('entityCreated', { entityId: 1 });
		expect(eventCount).toBe(1);

		unsubscribe();
		eventBus.publish('entityCreated', { entityId: 2 });

		expect(eventCount).toBe(1);
	});

	test('should handle clearing all events', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let count1 = 0;
		let count2 = 0;

		eventBus.subscribe('entityCreated', () => { count1++; });
		eventBus.subscribe('entityDestroyed', () => { count2++; });
		eventBus.publish('entityCreated', { entityId: 1 });
		eventBus.publish('entityDestroyed', { entityId: 2 });

		expect(count1).toBe(1);
		expect(count2).toBe(1);

		eventBus.clear();
		eventBus.publish('entityCreated', { entityId: 3 });
		eventBus.publish('entityDestroyed', { entityId: 4 });

		expect(count1).toBe(1);
		expect(count2).toBe(1);
	});

	test('should handle clearing specific events', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let count1 = 0;
		let count2 = 0;

		eventBus.subscribe('entityCreated', () => { count1++; });
		eventBus.subscribe('entityDestroyed', () => { count2++; });
		eventBus.clearEvent('entityCreated');
		eventBus.publish('entityCreated', { entityId: 1 });
		eventBus.publish('entityDestroyed', { entityId: 2 });

		// Only entityDestroyed should have been received
		expect(count1).toBe(0);
		expect(count2).toBe(1);
	});

	test('should auto-register event handlers from systems', () => {
		let eventHandlerCalled = false;

		const plugin = definePlugin('health')
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.install((world) => {
				world.addSystem('health-system')
					.setEventHandlers({
						playerDamaged: ({ data }: { data: { entityId: number; amount: number } }) => {
							eventHandlerCalled = true;
							expect(data.amount).toBe(10);
						}
					});
			});

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.withPlugin(plugin)
			.build();

		// Create an entity
		const entity = world.spawn({
			health: {
				value: 100,
			},
		});

		// Publish an event to trigger the handler
		world.eventBus.publish('playerDamaged', { entityId: entity.id, amount: 10 });

		// Verify the event handler was called
		expect(eventHandlerCalled).toBe(true);
	});

	test('should provide eventBus and entityManager parameters to event handlers', () => {
		let receivedEntityManager: any = null;
		let receivedData: any = null;

		const plugin = definePlugin('param-test')
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.install((world) => {
				world.addSystem('ParameterTestSystem')
					.setEventHandlers({
						healthChanged: ({ data, ecs }) => {
							receivedData = data;
							receivedEntityManager = ecs.entityManager;
						}
					});
			});

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.withPlugin(plugin)
			.build();

		// Create an entity with health component
		const entity = world.spawn({
			health: { value: 100 },
		});

		// Publish an event
		world.eventBus.publish('healthChanged', {
			entityId: entity.id,
			oldValue: 100,
			newValue: 80
		});

		// Verify that the handler received the correct parameters
		expect(receivedData).toEqual({
			entityId: entity.id,
			oldValue: 100,
			newValue: 80
		});
		expect(receivedEntityManager).not.toBeNull();

		// Verify that we can use the entity manager to get component data
		const health = receivedEntityManager.getComponent(entity.id, 'health');
		expect(health).toEqual({ value: 100 });
	});

	test('should handle event handlers during system lifecycle', () => {
		// Create a world
		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.build();

		// Create an entity with health component
		const entity = world.spawn({
			health: {
				value: 100,
			},
		});

		// Track events received
		const receivedEvents: string[] = [];

		// Subscribe directly to the event bus
		const unsubscribe = world.eventBus.subscribe('healthChanged', (data: any) => {
			receivedEvents.push(`health:${data.oldValue}->${data.newValue}`);
		});

		// Publish an event to verify the handler works
		world.eventBus.publish('healthChanged', {
			entityId: entity.id,
			oldValue: 100,
			newValue: 90
		});

		// Check that the event was received
		expect(receivedEvents).toEqual(['health:100->90']);

		// Clear events and unsubscribe
		receivedEvents.length = 0;
		unsubscribe();

		// Publish another event - should NOT be received since we unsubscribed
		world.eventBus.publish('healthChanged', {
			entityId: entity.id,
			oldValue: 90,
			newValue: 0
		});

		// No events should be received after unsubscribing
		expect(receivedEvents).toEqual([]);
	});

	test('should integrate event system with ECS for event-driven behavior', () => {
		const damageLog: Record<number, string[]> = {};

		const plugin = definePlugin('damage')
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.install((world) => {
				world.addSystem('EventDrivenDamageSystem')
					.setEventHandlers({
						collision: ({ data, ecs }) => {
							const entity1 = ecs.entityManager.getEntity(data.entity1Id);
							const entity2 = ecs.entityManager.getEntity(data.entity2Id);

							if (entity1 && entity2) {
								if (ecs.entityManager.getComponent(entity1.id, 'health') &&
									ecs.entityManager.getComponent(entity2.id, 'health')) {

									const health1 = ecs.entityManager.getComponent(entity1.id, 'health');
									const health2 = ecs.entityManager.getComponent(entity2.id, 'health');

									if (health1 && health2) {
										damageLog[entity1.id] = damageLog[entity1.id] || [];
										damageLog[entity2.id] = damageLog[entity2.id] || [];
										damageLog[entity1.id]?.push(`health=${health1.value}`);
										damageLog[entity2.id]?.push(`health=${health2.value}`);

										const newHealth1 = { value: Math.max(0, health1.value - 10) };
										const newHealth2 = { value: Math.max(0, health2.value - 10) };

										ecs.entityManager.addComponent(entity1.id, 'health', newHealth1);
										ecs.entityManager.addComponent(entity2.id, 'health', newHealth2);

										ecs.eventBus.publish('healthChanged', {
											entityId: entity1.id,
											oldValue: health1.value,
											newValue: newHealth1.value
										});

										ecs.eventBus.publish('healthChanged', {
											entityId: entity2.id,
											oldValue: health2.value,
											newValue: newHealth2.value
										});
									}
								}
							}
						},
						healthChanged({ data }) {
							if (!damageLog[data.entityId]) {
								damageLog[data.entityId] = [];
							}
							damageLog[data.entityId]?.push(`healthChanged=${data.newValue}`);
						}
					});
			});

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.withPlugin(plugin)
			.build();

		// Create entities to test with
		const entity = world.spawn({
			health: { value: 100 },
			position: { x: 0, y: 0 }
		});

		const entity2 = world.spawn({
			health: { value: 80 },
			position: { x: 10, y: 10 }
		});

		// Simulate a collision between the entities
		world.eventBus.publish('collision', {
			entity1Id: entity.id,
			entity2Id: entity2.id
		});

		// Check that health values were logged and events were emitted
		expect(damageLog[entity.id]).toEqual([
			'health=100',
			'healthChanged=90'
		]);
		expect(damageLog[entity2.id]).toEqual([
			'health=80',
			'healthChanged=70'
		]);

		// Check that the health components were actually updated
		expect(world.entityManager.getComponent(entity.id, 'health')).toEqual({ value: 90 });
		expect(world.entityManager.getComponent(entity2.id, 'health')).toEqual({ value: 70 });
	});

	test('should unsubscribe specific callback by reference', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let handler1Count = 0;
		let handler2Count = 0;

		const handler1 = () => { handler1Count++; };
		const handler2 = () => { handler2Count++; };

		eventBus.subscribe('entityCreated', handler1);
		eventBus.subscribe('entityCreated', handler2);

		// Both handlers should receive the event
		eventBus.publish('entityCreated', { entityId: 1 });
		expect(handler1Count).toBe(1);
		expect(handler2Count).toBe(1);

		// Unsubscribe handler1 by reference
		const removed = eventBus.unsubscribe('entityCreated', handler1);
		expect(removed).toBe(true);

		// Only handler2 should receive this event
		eventBus.publish('entityCreated', { entityId: 2 });
		expect(handler1Count).toBe(1); // Still 1
		expect(handler2Count).toBe(2); // Now 2
	});

	test('should return false when unsubscribing non-existent callback', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();

		const handler = () => {};
		const differentHandler = () => {};

		eventBus.subscribe('entityCreated', handler);

		// Try to unsubscribe a different callback
		const removed = eventBus.unsubscribe('entityCreated', differentHandler);
		expect(removed).toBe(false);
	});

	test('should return false when unsubscribing from non-existent event type', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();

		const handler = () => {};

		// Try to unsubscribe from an event type that has no handlers
		const removed = eventBus.unsubscribe('entityCreated', handler);
		expect(removed).toBe(false);
	});
});

describe('publish correctness', () => {
	test('once-handler fires exactly once across multiple publishes', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let count = 0;
		eventBus.once('entityCreated', () => { count++; });

		eventBus.publish('entityCreated', { entityId: 1 });
		eventBus.publish('entityCreated', { entityId: 2 });
		eventBus.publish('entityCreated', { entityId: 3 });

		expect(count).toBe(1);
	});

	test('handler added during publish does not fire in same publish', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let innerCalled = false;

		eventBus.subscribe('entityCreated', () => {
			eventBus.subscribe('entityCreated', () => {
				innerCalled = true;
			});
		});

		eventBus.publish('entityCreated', { entityId: 1 });
		expect(innerCalled).toBe(false);

		// Should fire on next publish
		eventBus.publish('entityCreated', { entityId: 2 });
		expect(innerCalled).toBe(true);
	});

	test('mid-publish unsubscribe of later handler does not crash', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();

		let laterCalls = 0;
		const unsubLater = eventBus.subscribe('entityCreated', () => {
			laterCalls++;
		});

		// Clear and re-register so the unsubscriber runs first
		eventBus.clearEvent('entityCreated');

		let firstCalled = false;
		eventBus.subscribe('entityCreated', () => {
			firstCalled = true;
			unsubLater(); // unsubscribe the later handler mid-publish
		});
		eventBus.subscribe('entityCreated', () => {
			laterCalls++;
		});

		// Should not throw — key invariant is no crash
		eventBus.publish('entityCreated', { entityId: 1 });
		expect(firstCalled).toBe(true);

		// After publish, the later handler should be gone
		laterCalls = 0;
		eventBus.publish('entityCreated', { entityId: 2 });
		expect(laterCalls).toBe(1); // only the second subscription remains
	});

	test('mid-publish unsubscribe does not skip an unrelated live handler', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		const calls: string[] = [];
		let unsubscribeLater: (() => void) | undefined;

		eventBus.subscribe('entityCreated', () => {
			calls.push('first');
			unsubscribeLater?.();
		});
		unsubscribeLater = eventBus.subscribe('entityCreated', () => {
			calls.push('later');
		});
		eventBus.subscribe('entityCreated', () => {
			calls.push('unrelated');
		});

		eventBus.publish('entityCreated', { entityId: 1 });

		expect(calls).toEqual(['first', 'unrelated']);
	});

	test('multiple once-handlers are all removed after publish', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TestEvents>>();
		let count1 = 0;
		let count2 = 0;

		eventBus.once('entityCreated', () => { count1++; });
		eventBus.once('entityCreated', () => { count2++; });

		eventBus.publish('entityCreated', { entityId: 1 });
		expect(count1).toBe(1);
		expect(count2).toBe(1);

		eventBus.publish('entityCreated', { entityId: 2 });
		expect(count1).toBe(1);
		expect(count2).toBe(1);
	});
});

describe('system event activation', () => {
	test('uses live group, screen, and asset gates and detaches cleanly', async () => {
		const world = ECSpresso.create()
			.withEventTypes<TestEvents>()
			.withAssets(assets => assets.add('sprite', async () => 'sprite'))
			.withScreens(screens => screens.add('menu', {
				initialState: () => ({}),
			}))
			.build();
		let systemCalls = 0;
		let directCalls = 0;

		world.addSystem('gated-events')
			.inGroup('gated')
			.inScreens(['menu'])
			.requiresAssets(['sprite'])
			.setEventHandlers({
				playerDamaged: () => { systemCalls++; },
			});
		world.on('playerDamaged', () => { directCalls++; });

		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });
		await world.initialize();
		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });
		await world.setScreen('menu', {});
		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });
		world.disableSystemGroup('gated');
		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });
		world.enableSystemGroup('gated');
		world.removeSystem('gated-events');
		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });

		expect(systemCalls).toBe(1);
		expect(directCalls).toBe(5);
		await world.dispose();
	});

	test('removing a system from its event handler is safe during publication', () => {
		const world = ECSpresso.create().withEventTypes<TestEvents>().build();
		const calls: string[] = [];
		world.addSystem('self-removing')
			.setEventHandlers({
				playerDamaged: () => {
					calls.push('system');
					world.removeSystem('self-removing');
				},
			});
		world.eventBus.subscribe('playerDamaged', () => { calls.push('other'); });

		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });
		world.eventBus.publish('playerDamaged', { entityId: 1, amount: 1 });

		expect(calls).toEqual(['system', 'other', 'other']);
	});
});

describe('publish type safety', () => {
	interface TypeSafetyEvents {
		ping: void;
		signal: undefined;
		hit: { damage: number };
		gameStart: true;
	}

	test('void events do not require data', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TypeSafetyEvents>>();
		let called = false;
		eventBus.subscribe('ping', () => { called = true; });
		eventBus.publish('ping');
		expect(called).toBe(true);
	});

	test('undefined events do not require data', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TypeSafetyEvents>>();
		let called = false;
		eventBus.subscribe('signal', () => { called = true; });
		eventBus.publish('signal');
		expect(called).toBe(true);
	});

	test('payload events require data', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TypeSafetyEvents>>();
		// @ts-expect-error - data is required for hit events
		eventBus.publish('hit');
		eventBus.publish('hit', { damage: 10 });
	});

	test('literal events require data', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TypeSafetyEvents>>();
		// @ts-expect-error - data is required for gameStart events
		eventBus.publish('gameStart');
		eventBus.publish('gameStart', true);
	});

	test('mixed types enforced independently', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TypeSafetyEvents>>();
		eventBus.publish('ping');
		eventBus.publish('signal');
		// @ts-expect-error - data is required for hit events
		eventBus.publish('hit');
		// @ts-expect-error - data is required for gameStart events
		eventBus.publish('gameStart');
		eventBus.publish('hit', { damage: 5 });
		eventBus.publish('gameStart', true);
	});

	test('wrong data type is rejected', () => {
		const { eventBus } = new ECSpresso<WorldConfigFrom<TestComponents, TypeSafetyEvents>>();
		// @ts-expect-error - wrong data type for hit
		eventBus.publish('hit', 'wrong');
		eventBus.publish('hit', { damage: 1 });
	});
});
