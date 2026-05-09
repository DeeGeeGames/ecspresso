import { describe, test, expect, spyOn } from 'bun:test';
import ECSpresso from './ecspresso';
import CommandBuffer from './command-buffer';
import { createTimer, createTimerPlugin } from './plugins/scripting/timers';
import type { WorldConfigFrom } from './type-utils';

interface TestComponents {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
	tag: boolean;
}

interface TestEvents {
	test: boolean;
}

interface TestResources {
	counter: number;
}

type TestConfig = WorldConfigFrom<TestComponents, TestEvents, TestResources>;

describe('CommandBuffer', () => {
	describe('Basic Operations', () => {
		test('should queue commands without executing immediately', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			// Queue removal command
			buffer.removeEntity(entity.id);

			// Entity should still exist (command not executed)
			expect(ecs.entityManager.getEntity(entity.id)).toBeDefined();
		});

		test('should execute commands in FIFO order on playback', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();


			// Queue multiple commands
			buffer.spawn({ position: { x: 1, y: 1 } });
			buffer.spawn({ position: { x: 2, y: 2 } });
			buffer.spawn({ position: { x: 3, y: 3 } });

			// Playback and track order
			buffer.playback(ecs);

			const entities = ecs.getEntitiesWithQuery(['position']);
			expect(entities.length).toBe(3);
			expect(entities[0]?.components.position.x).toBe(1);
			expect(entities[1]?.components.position.x).toBe(2);
			expect(entities[2]?.components.position.x).toBe(3);
		});

		test('should clear all queued commands', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			// Queue commands
			buffer.spawn({ position: { x: 1, y: 1 } });
			buffer.spawn({ position: { x: 2, y: 2 } });

			// Clear before playback
			buffer.clear();

			// Playback should do nothing
			buffer.playback(ecs);

			const entities = ecs.getEntitiesWithQuery(['position']);
			expect(entities.length).toBe(0);
		});

		test('should not re-execute commands after playback', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			buffer.spawn({ position: { x: 1, y: 1 } });

			// First playback
			buffer.playback(ecs);
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(1);

			// Second playback should not add another entity
			buffer.playback(ecs);
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(1);
		});
	});

	describe('removeEntity', () => {
		test('should queue entity removal', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			buffer.removeEntity(entity.id);
			expect(ecs.entityManager.getEntity(entity.id)).toBeDefined();

			buffer.playback(ecs);
			expect(ecs.entityManager.getEntity(entity.id)).toBeUndefined();
		});

		test('should remove multiple entities in order', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const e1 = ecs.spawn({ position: { x: 1, y: 1 } });
			const e2 = ecs.spawn({ position: { x: 2, y: 2 } });
			const e3 = ecs.spawn({ position: { x: 3, y: 3 } });

			buffer.removeEntity(e1.id);
			buffer.removeEntity(e3.id);

			buffer.playback(ecs);

			expect(ecs.entityManager.getEntity(e1.id)).toBeUndefined();
			expect(ecs.entityManager.getEntity(e2.id)).toBeDefined();
			expect(ecs.entityManager.getEntity(e3.id)).toBeUndefined();
		});
	});

	describe('addComponent', () => {
		test('should queue component addition', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			buffer.addComponent(entity.id, 'velocity', { x: 1, y: 1 });
			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toBeUndefined();

			buffer.playback(ecs);
			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toEqual({ x: 1, y: 1 });
		});

		test('should add multiple components to same entity', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			buffer.addComponent(entity.id, 'velocity', { x: 1, y: 1 });
			buffer.addComponent(entity.id, 'health', { value: 100 });

			buffer.playback(ecs);

			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toEqual({ x: 1, y: 1 });
			expect(ecs.entityManager.getComponent(entity.id, 'health')).toEqual({ value: 100 });
		});
	});

	describe('removeComponent', () => {
		test('should queue component removal', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 1 } });

			buffer.removeComponent(entity.id, 'velocity');
			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toEqual({ x: 1, y: 1 });

			buffer.playback(ecs);
			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toBeUndefined();
		});
	});

	describe('spawn', () => {
		test('should queue entity spawn', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			buffer.spawn({ position: { x: 10, y: 20 }, velocity: { x: 1, y: 1 } });

			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(0);

			buffer.playback(ecs);

			const entities = ecs.getEntitiesWithQuery(['position', 'velocity']);
			expect(entities.length).toBe(1);
			expect(entities[0]?.components.position).toEqual({ x: 10, y: 20 });
		});

		test('should spawn multiple entities', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			buffer.spawn({ position: { x: 1, y: 1 } });
			buffer.spawn({ position: { x: 2, y: 2 } });
			buffer.spawn({ position: { x: 3, y: 3 } });

			buffer.playback(ecs);

			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(3);
		});
	});

	describe('spawnChild', () => {
		test('should queue child entity spawn', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const parent = ecs.spawn({ position: { x: 0, y: 0 } });

			buffer.spawnChild(parent.id, { position: { x: 5, y: 5 } });

			expect(ecs.getChildren(parent.id).length).toBe(0);

			buffer.playback(ecs);

			const children = ecs.getChildren(parent.id);
			expect(children.length).toBe(1);
		});
	});

	describe('addComponents', () => {
		test('should queue multiple component additions', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			buffer.addComponents(entity.id, {
				velocity: { x: 1, y: 1 },
				health: { value: 100 }
			});

			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toBeUndefined();
			expect(ecs.entityManager.getComponent(entity.id, 'health')).toBeUndefined();

			buffer.playback(ecs);

			expect(ecs.entityManager.getComponent(entity.id, 'velocity')).toEqual({ x: 1, y: 1 });
			expect(ecs.entityManager.getComponent(entity.id, 'health')).toEqual({ value: 100 });
		});
	});

	describe('setParent', () => {
		test('should queue parent assignment', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const parent = ecs.spawn({ position: { x: 0, y: 0 } });
			const child = ecs.spawn({ position: { x: 5, y: 5 } });

			buffer.setParent(child.id, parent.id);

			expect(ecs.getParent(child.id)).toBe(null);

			buffer.playback(ecs);

			expect(ecs.getParent(child.id)).toBe(parent.id);
		});
	});

	describe('removeParent', () => {
		test('should queue parent removal', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const parent = ecs.spawn({ position: { x: 0, y: 0 } });
			const child = ecs.spawnChild(parent.id, { position: { x: 5, y: 5 } });

			buffer.removeParent(child.id);

			expect(ecs.getParent(child.id)).toBe(parent.id);

			buffer.playback(ecs);

			expect(ecs.getParent(child.id)).toBe(null);
		});
	});

	describe('mutateComponent', () => {
		test('should queue a component mutation', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			buffer.mutateComponent(entity.id, 'position', (pos) => {
				pos.x = 99;
			});

			// Not yet applied
			expect(ecs.getComponent(entity.id, 'position')).toEqual({ x: 0, y: 0 });

			buffer.playback(ecs);

			expect(ecs.getComponent(entity.id, 'position')).toEqual({ x: 99, y: 0 });
		});

		test('should handle non-existent entity gracefully during playback', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			buffer.mutateComponent(999, 'position', (pos) => {
				pos.x = 1;
			});

			const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
			expect(() => { buffer.playback(ecs); }).not.toThrow();
			warnSpy.mockRestore();
		});

		test('commands.mutateComponent works via ECSpresso integration', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const entity = ecs.spawn({ health: { value: 100 } });

			ecs.addSystem('damage')
				.addQuery('entities', { with: ['health'] })
				.setProcess(({ ecs: world }) => {
					world.commands.mutateComponent(entity.id, 'health', (h) => {
						h.value -= 10;
					});
				});

			ecs.update(1 / 60);

			expect(ecs.getComponent(entity.id, 'health')).toEqual({ value: 90 });
		});
	});

	describe('Complex Scenarios', () => {
		test('should handle mixed operations in correct order', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			// Create initial entity
			const e1 = ecs.spawn({ position: { x: 0, y: 0 } });

			// Queue operations
			buffer.spawn({ position: { x: 1, y: 1 } }); // Create new
			buffer.addComponent(e1.id, 'velocity', { x: 2, y: 2 }); // Add to existing
			buffer.spawn({ position: { x: 3, y: 3 } }); // Create another
			buffer.removeComponent(e1.id, 'position'); // Remove from existing

			buffer.playback(ecs);

			// Verify results
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(2); // e1 has no position now
			expect(ecs.entityManager.getComponent(e1.id, 'velocity')).toEqual({ x: 2, y: 2 });
			expect(ecs.entityManager.getComponent(e1.id, 'position')).toBeUndefined();
		});

		test('should handle entity creation and immediate removal', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			const entity = ecs.spawn({ position: { x: 0, y: 0 } });

			// Queue spawn and remove in same batch
			buffer.removeEntity(entity.id);
			buffer.spawn({ position: { x: 1, y: 1 } });

			buffer.playback(ecs);

			// Old entity should be gone, new one should exist
			expect(ecs.entityManager.getEntity(entity.id)).toBeUndefined();
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(1);
		});

		test('should handle operations on non-existent entities gracefully', () => {
			const ecs = ECSpresso.create<TestConfig>().build();
			const buffer = new CommandBuffer<TestConfig>();

			// Queue operations on non-existent entity
			buffer.addComponent(999, 'position', { x: 0, y: 0 });
			buffer.removeComponent(999, 'position');
			buffer.removeEntity(999);

			// Should not throw — suppress expected warnings from catch-and-log in playback
			const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
			expect(() => { buffer.playback(ecs); }).not.toThrow();
			warnSpy.mockRestore();
		});
	});

	describe('Integration with ECSpresso', () => {
		test('ECSpresso should have commands property', () => {
			const ecs = ECSpresso.create<TestConfig>().build();

			expect(ecs.commands).toBeDefined();
			expect(typeof ecs.commands.removeEntity).toBe('function');
			expect(typeof ecs.commands.spawn).toBe('function');
		});

		test('commands should execute automatically after update()', () => {
			const ecs = ECSpresso.create<TestConfig>().build();

			ecs.addSystem('test')
				.setProcess(({ ecs }) => {
					ecs.commands.spawn({ position: { x: 1, y: 1 } });
				});

			// Before update
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(0);

			// After update
			ecs.update(0.016);

			// Command should have been executed
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(1);
		});

		test('queries should reflect post-playback state', () => {
			const ecs = ECSpresso.create<TestConfig>().build();

			const entity = ecs.spawn({ position: { x: 0, y: 0 }, tag: true });

			let queriesSeenDuringSystem = 0;
			let queriesSeenAfterUpdate = 0;

			ecs.addSystem('test')
				.addQuery('tagged', { with: ['tag'] })
				.setProcess(({ queries: { tagged }, ecs }) => {
					queriesSeenDuringSystem = tagged.length;

					// Remove entity via commands
					ecs.commands.removeEntity(entity.id);
				});

			ecs.update(0.016);

			queriesSeenAfterUpdate = ecs.getEntitiesWithQuery(['tag']).length;

			// During system, entity was still there
			expect(queriesSeenDuringSystem).toBe(1);

			// After update, entity should be gone
			expect(queriesSeenAfterUpdate).toBe(0);
		});

		test('immediate methods should still work alongside commands', () => {
			const ecs = ECSpresso.create<TestConfig>().build();

			// Immediate spawn
			const e1 = ecs.spawn({ position: { x: 0, y: 0 } });
			expect(ecs.entityManager.getEntity(e1.id)).toBeDefined();

			// Deferred spawn
			ecs.commands.spawn({ position: { x: 1, y: 1 } });
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(1); // Only e1

			// After update, both exist
			ecs.update(0.016);
			expect(ecs.getEntitiesWithQuery(['position']).length).toBe(2);
		});
	});

	describe('Integration with Timer Events', () => {
		test('timer onComplete callback can use command buffer to remove entities', () => {
			const ecs = ECSpresso
				.create<TestConfig>()
				.withPlugin(createTimerPlugin())
				.build();

			const targetEntity = ecs.spawn({ position: { x: 0, y: 0 }, tag: true });

			let timerFiredEntityId = -1;

			// Create timer with onComplete callback that removes entity via commands
			const timerEntity = ecs.spawn({
				timers: {
					fuse: createTimer(0.5, {
						onComplete: (data) => {
							timerFiredEntityId = data.entityId;
							ecs.commands.removeEntity(targetEntity.id);
						},
					}),
				},
				position: { x: 1, y: 1 },
			});

			// Entity should exist before update
			expect(ecs.entityManager.getEntity(targetEntity.id)).toBeDefined();

			// Update past timer
			ecs.update(0.6);

			// Timer should have fired
			expect(timerFiredEntityId).toBe(timerEntity.id);

			// Entity should be removed after update (commands executed)
			expect(ecs.entityManager.getEntity(targetEntity.id)).toBeUndefined();
		});

		test('multiple timers with onComplete callbacks that queue commands', () => {
			const ecs = ECSpresso
				.create<TestConfig>()
				.withPlugin(createTimerPlugin())
				.build();

			const spawnCallback = () => {
				ecs.commands.spawn({ position: { x: 10, y: 10 }, health: { value: 100 } });
			};

			// Create timers with onComplete callbacks
			ecs.spawn({ timers: { fuse: createTimer(0.3, { onComplete: spawnCallback }) } });
			ecs.spawn({ timers: { fuse: createTimer(0.5, { onComplete: spawnCallback }) } });

			// Before update, no entities with health
			expect(ecs.getEntitiesWithQuery(['health']).length).toBe(0);

			// Update to fire both timers
			ecs.update(0.6);

			// After update, 2 entities should have been spawned
			expect(ecs.getEntitiesWithQuery(['health']).length).toBe(2);
		});

		test('commands queued in onComplete callback execute in same frame', () => {
			const ecs = ECSpresso
				.create<TestConfig>()
				.withPlugin(createTimerPlugin())
				.build();

			// Create several entities
			ecs.spawn({ position: { x: 1, y: 1 }, tag: true });
			ecs.spawn({ position: { x: 2, y: 2 }, tag: true });
			ecs.spawn({ position: { x: 3, y: 3 }, tag: true });

			// Timer with onComplete callback that queues removal of all tagged entities
			ecs.spawn({
				timers: {
					fuse: createTimer(1.0, {
						onComplete: () => {
							const tagged = ecs.getEntitiesWithQuery(['tag']);
							tagged.forEach((entity) => {
								ecs.commands.removeEntity(entity.id);
							});
						},
					}),
				},
			});

			// All entities exist before update
			expect(ecs.getEntitiesWithQuery(['tag']).length).toBe(3);

			// Update past timer
			ecs.update(1.1);

			// All tagged entities should be removed after update
			expect(ecs.getEntitiesWithQuery(['tag']).length).toBe(0);
		});
	});
});
