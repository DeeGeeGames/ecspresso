import { expect, describe, test } from 'bun:test';
import ECSpresso from './ecspresso';
import { definePlugin } from './plugin';

// Define component types for testing
interface TestComponents {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
	marker: { id: string };
}



describe('SystemBuilder', () => {
	test('should create a system that can query entities', () => {
		const processedIds: number[] = [];

		const plugin = definePlugin('test')
			.withComponentTypes<TestComponents>()
			.install((world) => {
				world.addSystem('TestSystem')
					.addQuery('movingEntities', {
						with: ['position', 'velocity'],
						without: ['health']
					})
					.setProcess(({ queries }) => {
						for (const entity of queries.movingEntities) {
							processedIds.push(entity.id);
						}
					});
			});

		const world = ECSpresso.create().withComponentTypes<TestComponents>()
			.withPlugin(plugin)
			.build();

		const entity1 = world.spawn({
			position: { x: 0, y: 0 },
			velocity: { x: 5, y: 10 }
		});

		const entity2 = world.spawn({
			position: { x: 10, y: 20 },
			velocity: { x: -5, y: 0 },
			health: { value: 100 }
		});

		world.update(1/60);

		expect(processedIds).toContain(entity1.id);
		expect(processedIds).not.toContain(entity2.id);
	});

	test('should handle multiple query definitions', () => {
		const queriesProcessed = {
			withMarker: [] as number[],
			withHealth: [] as number[],
		};

		const plugin = definePlugin('multi-query')
			.withComponentTypes<TestComponents>()
			.install((world) => {
				world.addSystem('MultiQuerySystem')
					.addQuery('withMarker', {
						with: ['marker']
					})
					.addQuery('withHealth', {
						with: ['health']
					})
					.setProcess(({ queries }) => {
						for (const entity of queries.withMarker) {
							queriesProcessed.withMarker.push(entity.id);
						}
						for (const entity of queries.withHealth) {
							queriesProcessed.withHealth.push(entity.id);
						}
					});
			});

		const world = ECSpresso.create().withComponentTypes<TestComponents>()
			.withPlugin(plugin)
			.build();

		const entity1 = world.spawn({
			marker: { id: 'entity1' }
		});

		const entity2 = world.spawn({
			health: { value: 100 }
		});

		const entity3 = world.spawn({
			marker: { id: 'entity3' },
			health: { value: 80 }
		});

		world.update(1/60);

		expect(queriesProcessed['withMarker']).toContain(entity1.id);
		expect(queriesProcessed['withMarker']).toContain(entity3.id);
		expect(queriesProcessed['withMarker']).not.toContain(entity2.id);

		expect(queriesProcessed['withHealth']).toContain(entity2.id);
		expect(queriesProcessed['withHealth']).toContain(entity3.id);
		expect(queriesProcessed['withHealth']).not.toContain(entity1.id);
	});

	test('should support lifecycle hooks', async () => {
		let onInitializeCalled = false;
		let onDetachCalled = false;
		let processCalledCount = 0;

		const plugin = definePlugin('lifecycle')
			.withComponentTypes<TestComponents>()
			.install((world) => {
				world.addSystem('LifecycleSystem')
					.setOnInitialize(() => {
						onInitializeCalled = true;
					})
					.addQuery('entities', {
						with: ['position']
					})
					.setProcess(() => {
						processCalledCount++;
					})
					.setOnDetach(() => {
						onDetachCalled = true;
					});
			});

		const world = ECSpresso.create().withComponentTypes<TestComponents>()
			.withPlugin(plugin)
			.build();

		await world.initialize();

		expect(onInitializeCalled).toBe(true);
		expect(onDetachCalled).toBe(false);
		expect(processCalledCount).toBe(0);

		world.spawn({
			position: { x: 0, y: 0 }
		});

		world.update(1/60);
		expect(processCalledCount).toBe(1);

		world.removeSystem('LifecycleSystem');
		expect(onDetachCalled).toBe(true);

		world.update(1/60);
		expect(processCalledCount).toBe(1);
	});

	test('should support statically typed queries with correct component access', () => {
		const plugin = definePlugin('typed')
			.withComponentTypes<TestComponents>()
			.install((world) => {
				world.addSystem('TypedSystem')
					.addQuery('entities', {
						with: ['position', 'health']
					})
					.setProcess(({ queries }) => {
						for (const entity of queries.entities) {
							const pos = entity.components.position;
							const health = entity.components.health;

							pos.x += 1;
							pos.y += 2;

							health.value -= 1;
						}
					});
			});

		const world = ECSpresso.create().withComponentTypes<TestComponents>()
			.withPlugin(plugin)
			.build();

		const entity = world.spawn({
			position: { x: 10, y: 20 },
			health: { value: 100 }
		});

		world.update(1/60);

		const updatedPos = world.entityManager.getComponent(entity.id, 'position');
		const updatedHealth = world.entityManager.getComponent(entity.id, 'health');

		expect(updatedPos).toEqual({ x: 11, y: 22 });
		expect(updatedHealth).toEqual({ value: 99 });
	});

	test('withResources injects typed resources into process callback', () => {
		interface Resources {
			config: { speed: number };
			score: { value: number };
		}

		const received: { config: Resources['config']; score: Resources['score'] }[] = [];

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withResourceTypes<Resources>()
			.withResource('config', { speed: 42 })
			.withResource('score', { value: 100 })
			.build();

		world.addSystem('resourceSystem')
			.addQuery('entities', { with: ['position'] })
			.withResources(['config', 'score'])
			.setProcess(({ resources: { config, score } }) => {
				received.push({ config, score });
			});

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);
		world.update(1 / 60);

		expect(received).toHaveLength(2);
		expect(received[0]!.config.speed).toBe(42);
		expect(received[0]!.score.value).toBe(100);
	});

	test('withResources resolves once and reuses the same object', () => {
		const resourceObjects: Record<string, unknown>[] = [];

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withResourceTypes<{ config: { speed: number } }>()
			.withResource('config', { speed: 10 })
			.build();

		world.addSystem('cacheTest')
			.withResources(['config'])
			.runWhenEmpty()
			.setProcess(({ resources }) => {
				resourceObjects.push(resources);
			});

		world.update(1 / 60);
		world.update(1 / 60);
		world.update(1 / 60);

		expect(resourceObjects).toHaveLength(3);
		// Same reference every frame — zero allocation
		expect(resourceObjects[0]).toBe(resourceObjects[1]);
		expect(resourceObjects[1]).toBe(resourceObjects[2]);
	});

	test('withResources works without queries (runWhenEmpty)', () => {
		let callCount = 0;

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withResourceTypes<{ state: { paused: boolean } }>()
			.withResource('state', { paused: false })
			.build();

		world.addSystem('noQueryResources')
			.withResources(['state'])
			.runWhenEmpty()
			.setProcess(({ resources: { state } }) => {
				if (!state.paused) callCount++;
			});

		world.update(1 / 60);
		expect(callCount).toBe(1);
	});

	test('withResources works regardless of chain order with addQuery', () => {
		const results: number[] = [];

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withResourceTypes<{ multiplier: { value: number } }>()
			.withResource('multiplier', { value: 3 })
			.build();

		// withResources before addQuery
		world.addSystem('resourceFirst')
			.withResources(['multiplier'])
			.addQuery('entities', { with: ['position'] })
			.setProcess(({ resources: { multiplier } }) => {
				results.push(multiplier.value);
			});

		// addQuery before withResources
		world.addSystem('queryFirst')
			.addQuery('entities', { with: ['position'] })
			.withResources(['multiplier'])
			.setProcess(({ resources: { multiplier } }) => {
				results.push(multiplier.value * 10);
			});

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);

		expect(results).toContain(3);
		expect(results).toContain(30);
	});

	test('systems without withResources still work with 3-param setProcess', () => {
		let called = false;

		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.build();

		world.addSystem('classic')
			.addQuery('entities', { with: ['position'] })
			.setProcess(({ queries }) => {
				if (queries.entities.length > 0) called = true;
			});

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);
		expect(called).toBe(true);
	});

	test('should support multiple addSystem calls on same world', () => {
		let system1Processed = false;
		let system2Processed = false;

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('system1')
			.addQuery('moving', { with: ['position', 'velocity'] })
			.setProcess(() => { system1Processed = true; });
		world.addSystem('system2')
			.addQuery('healthy', { with: ['position', 'health'] })
			.setProcess(() => { system2Processed = true; });

		world.spawn({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 1 } });
		world.spawn({ position: { x: 0, y: 0 }, health: { value: 100 } });
		world.update(1/60);

		expect(system1Processed).toBe(true);
		expect(system2Processed).toBe(true);
	});
});

describe('setProcessEach', () => {
	test('iterates every matching entity with correct dt', () => {
		const seen: { id: number; dt: number }[] = [];

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('iter')
			.setProcessEach(
				{ with: ['position', 'velocity'] },
				({ entity, dt }) => {
					seen.push({ id: entity.id, dt });
				},
			);

		const e1 = world.spawn({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 1 } });
		const e2 = world.spawn({ position: { x: 10, y: 10 }, velocity: { x: 2, y: 2 } });
		world.spawn({ position: { x: 20, y: 20 } }); // no velocity, excluded

		world.update(1 / 60);

		expect(seen.map(s => s.id).sort()).toEqual([e1.id, e2.id].sort());
		expect(seen[0]!.dt).toBeCloseTo(1 / 60);
		expect(seen[1]!.dt).toBeCloseTo(1 / 60);
	});

	test('mutations via entity.components persist', () => {
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('movement')
			.setProcessEach(
				{ with: ['position', 'velocity'] },
				({ entity, dt }) => {
					entity.components.position.x += entity.components.velocity.x * dt;
					entity.components.position.y += entity.components.velocity.y * dt;
				},
			);

		const e = world.spawn({ position: { x: 0, y: 0 }, velocity: { x: 60, y: 120 } });
		world.update(1 / 60);

		const pos = world.entityManager.getComponent(e.id, 'position');
		expect(pos).toEqual({ x: 1, y: 2 });
	});

	test('without filter excludes entities with the listed component', () => {
		const seen: number[] = [];
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('alive')
			.setProcessEach(
				{ with: ['position'], without: ['health'] },
				({ entity }) => { seen.push(entity.id); },
			);

		const alive = world.spawn({ position: { x: 0, y: 0 } });
		world.spawn({ position: { x: 0, y: 0 }, health: { value: 100 } });

		world.update(1 / 60);
		expect(seen).toEqual([alive.id]);
	});

	test('optional yields present-or-undefined component', () => {
		const results: { id: number; hasHealth: boolean }[] = [];
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('maybe')
			.setProcessEach(
				{ with: ['position'], optional: ['health'] },
				({ entity }) => {
					results.push({
						id: entity.id,
						hasHealth: entity.components.health !== undefined,
					});
				},
			);

		const a = world.spawn({ position: { x: 0, y: 0 } });
		const b = world.spawn({ position: { x: 0, y: 0 }, health: { value: 100 } });

		world.update(1 / 60);

		expect(results.find(r => r.id === a.id)?.hasHealth).toBe(false);
		expect(results.find(r => r.id === b.id)?.hasHealth).toBe(true);
	});

	test('changed filter only iterates entities with changed components', () => {
		const seen: number[] = [];
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('changedOnly')
			.setProcessEach(
				{ with: ['position'], changed: ['position'] },
				({ entity }) => { seen.push(entity.id); },
			);

		const e1 = world.spawn({ position: { x: 0, y: 0 } });
		world.spawn({ position: { x: 5, y: 5 } });

		// First update: both freshly spawned, so both are "changed"
		world.update(1 / 60);
		seen.length = 0;

		// No further changes → no iteration
		world.update(1 / 60);
		expect(seen).toEqual([]);

		world.markChanged(e1.id, 'position');
		world.update(1 / 60);
		expect(seen).toEqual([e1.id]);
	});

	test('parentHas filter scopes to children of qualifying parents', () => {
		const seen: number[] = [];
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('childrenOfHealthy')
			.setProcessEach(
				{ with: ['position'], parentHas: ['health'] },
				({ entity }) => { seen.push(entity.id); },
			);

		const parent = world.spawn({ position: { x: 0, y: 0 }, health: { value: 100 } });
		const child = world.spawn({ position: { x: 10, y: 10 } });
		world.setParent(child.id, parent.id);

		const orphan = world.spawn({ position: { x: 50, y: 50 } });
		const unhealthyParent = world.spawn({ position: { x: 100, y: 100 } });
		const unhealthyChild = world.spawn({ position: { x: 110, y: 110 } });
		world.setParent(unhealthyChild.id, unhealthyParent.id);

		world.update(1 / 60);

		expect(seen).toContain(child.id);
		expect(seen).not.toContain(orphan.id);
		expect(seen).not.toContain(unhealthyChild.id);
		expect(seen).not.toContain(parent.id);
	});

	test('withResources threads resources into callback context', () => {
		const calls: number[] = [];
		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withResourceTypes<{ config: { speed: number } }>()
			.withResource('config', { speed: 99 })
			.build();

		world.addSystem('withRes')
			.withResources(['config'])
			.setProcessEach(
				{ with: ['position'] },
				({ resources: { config } }) => {
					calls.push(config.speed);
				},
			);

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);
		expect(calls).toEqual([99]);
	});

	test('withResources resolves once and reuses the same object', () => {
		const observed: Record<string, unknown>[] = [];
		const world = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.withResourceTypes<{ config: { speed: number } }>()
			.withResource('config', { speed: 10 })
			.build();

		world.addSystem('cacheTest')
			.withResources(['config'])
			.setProcessEach(
				{ with: ['position'] },
				({ resources }) => { observed.push(resources); },
			);

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);
		world.update(1 / 60);
		world.update(1 / 60);

		expect(observed).toHaveLength(3);
		expect(observed[0]).toBe(observed[1]);
		expect(observed[1]).toBe(observed[2]);
	});

	test('composes with inPhase / setPriority / inGroup', () => {
		const executionOrder: string[] = [];
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('preUpdater')
			.inPhase('preUpdate')
			.setPriority(10)
			.setProcessEach(
				{ with: ['position'] },
				() => { executionOrder.push('pre'); },
			);

		world.addSystem('updater')
			.inPhase('update')
			.setProcessEach(
				{ with: ['position'] },
				() => { executionOrder.push('upd'); },
			);

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);

		expect(executionOrder).toEqual(['pre', 'upd']);
	});

	test('inGroup gates execution alongside setProcessEach', () => {
		let calls = 0;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('grouped')
			.inGroup('myGroup')
			.setProcessEach(
				{ with: ['position'] },
				() => { calls++; },
			);

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);
		expect(calls).toBe(1);

		world.disableSystemGroup('myGroup');
		world.update(1 / 60);
		expect(calls).toBe(1);

		world.enableSystemGroup('myGroup');
		world.update(1 / 60);
		expect(calls).toBe(2);
	});

	test('supports setOnInitialize / setOnDetach after setProcessEach', async () => {
		let initCalled = false;
		let detachCalled = false;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('withLifecycle')
			.setProcessEach({ with: ['position'] }, () => {})
			.setOnInitialize(() => { initCalled = true; })
			.setOnDetach(() => { detachCalled = true; });

		await world.initialize();
		expect(initCalled).toBe(true);

		world.removeSystem('withLifecycle');
		expect(detachCalled).toBe(true);
	});

	test('runWhenEmpty does not invoke the per-entity callback when no entities match', () => {
		let calls = 0;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('emptyRuns')
			.runWhenEmpty()
			.setProcessEach(
				{ with: ['position'] },
				() => { calls++; },
			);

		world.update(1 / 60);
		expect(calls).toBe(0);
	});

	test('runtime guard: calling setProcessEach twice throws', () => {
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
		const builder = world.addSystem('twice')
			.setProcessEach({ with: ['position'] }, () => {});

		expect(() => {
			// @ts-expect-error — setProcessEach unavailable once __each is in Queries
			builder.setProcessEach({ with: ['position'] }, () => {});
		}).toThrow();
	});

	test('runtime guard: setProcessEach after addQuery throws', () => {
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
		const builder = world.addSystem('afterAddQuery')
			.addQuery('e', { with: ['position'] });

		expect(() => {
			// @ts-expect-error — setProcessEach unavailable after addQuery
			builder.setProcessEach({ with: ['position'] }, () => {});
		}).toThrow();
	});

	test('runtime guard: setProcessEach after setProcess throws', () => {
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
		const builder = world.addSystem('afterSetProcess')
			.addQuery('e', { with: ['position'] })
			.setProcess(() => {});

		expect(() => {
			// @ts-expect-error — setProcessEach unavailable after addQuery/setProcess
			builder.setProcessEach({ with: ['position'] }, () => {});
		}).toThrow();
	});

	test('entity type inference: with/optional/without narrow correctly', () => {
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('typeCheck')
			.setProcessEach(
				{ with: ['position'], optional: ['health'], without: ['marker'] },
				({ entity }) => {
					const x: number = entity.components.position.x;
					const y: number = entity.components.position.y;
					const health: { value: number } | undefined = entity.components.health;

					expect(typeof x).toBe('number');
					expect(typeof y).toBe('number');
					if (health !== undefined) {
						expect(typeof health.value).toBe('number');
					}
				},
			);

		world.spawn({ position: { x: 1, y: 2 } });
		world.spawn({ position: { x: 3, y: 4 }, health: { value: 50 } });
		world.update(1 / 60);
	});

	test('ecs is available in the callback context', () => {
		let observedEcs: unknown;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('ecsCheck')
			.setProcessEach(
				{ with: ['position'] },
				({ ecs }) => { observedEcs = ecs; },
			);

		world.spawn({ position: { x: 0, y: 0 } });
		world.update(1 / 60);

		expect(observedEcs).toBe(world);
	});
});

describe('SystemBuilder singletons', () => {
	test('yields undefined when no entity matches (process skipped by default)', () => {
		let processCalls = 0;

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('flagshipSystem')
			.addSingleton('flagship', { with: ['marker'] })
			.setProcess(() => {
				processCalls++;
			});

		world.update(1 / 60);

		expect(processCalls).toBe(0);
	});

	test('runWhenEmpty runs process with undefined singleton', () => {
		const observed: Array<unknown> = [];

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('flagshipSystem')
			.addSingleton('flagship', { with: ['marker'] })
			.runWhenEmpty()
			.setProcess(({ queries }) => {
				observed.push(queries.flagship);
			});

		world.update(1 / 60);

		expect(observed).toHaveLength(1);
		expect(observed[0]).toBeUndefined();
	});

	test('yields the entity when exactly one matches', () => {
		const observedIds: number[] = [];
		let observedMarker: string | undefined;

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('flagshipSystem')
			.addSingleton('flagship', { with: ['marker'] })
			.setProcess(({ queries }) => {
				if (!queries.flagship) return;
				observedIds.push(queries.flagship.id);
				observedMarker = queries.flagship.components.marker.id;
			});

		const only = world.spawn({ marker: { id: 'alpha' } });

		world.update(1 / 60);

		expect(observedIds).toEqual([only.id]);
		expect(observedMarker).toBe('alpha');
	});

	test('yields the first matching entity when multiple exist', () => {
		const observedIds: number[] = [];

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('flagshipSystem')
			.addSingleton('flagship', { with: ['marker'] })
			.setProcess(({ queries }) => {
				if (!queries.flagship) return;
				observedIds.push(queries.flagship.id);
			});

		const first = world.spawn({ marker: { id: 'a' } });
		world.spawn({ marker: { id: 'b' } });

		world.update(1 / 60);

		expect(observedIds).toEqual([first.id]);
	});

	test('coexists with addQuery on the same system', () => {
		const observedSingletonIds: number[] = [];
		const observedQueryCounts: number[] = [];

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('mixedSystem')
			.addSingleton('flagship', { with: ['marker'] })
			.addQuery('healthy', { with: ['health'] })
			.setProcess(({ queries }) => {
				if (!queries.flagship) return;
				observedSingletonIds.push(queries.flagship.id);
				observedQueryCounts.push(queries.healthy.length);
			});

		const flagship = world.spawn({ marker: { id: 'flag' } });
		world.spawn({ health: { value: 100 } });
		world.spawn({ health: { value: 50 } });

		world.update(1 / 60);

		expect(observedSingletonIds).toEqual([flagship.id]);
		expect(observedQueryCounts).toEqual([2]);
	});

	test('honors without filter on singleton', () => {
		const observedIds: number[] = [];

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('filteredSingleton')
			.addSingleton('flagship', { with: ['marker'], without: ['health'] })
			.setProcess(({ queries }) => {
				if (!queries.flagship) return;
				observedIds.push(queries.flagship.id);
			});

		world.spawn({ marker: { id: 'has-health' }, health: { value: 1 } });
		const noHealth = world.spawn({ marker: { id: 'no-health' } });

		world.update(1 / 60);

		expect(observedIds).toEqual([noHealth.id]);
	});

	test('singleton-only system skips process when singleton absent without runWhenEmpty', () => {
		let processCalls = 0;

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('singletonOnly')
			.addSingleton('flagship', { with: ['marker'] })
			.setProcess(() => {
				processCalls++;
			});

		world.update(1 / 60);
		expect(processCalls).toBe(0);

		world.spawn({ marker: { id: 'now-present' } });
		world.update(1 / 60);
		expect(processCalls).toBe(1);
	});

	test('singleton presence counts toward hasResults alongside empty query', () => {
		let processCalls = 0;

		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('mixedGating')
			.addSingleton('flagship', { with: ['marker'] })
			.addQuery('healthy', { with: ['health'] })
			.setProcess(() => {
				processCalls++;
			});

		world.spawn({ marker: { id: 'flag' } });

		world.update(1 / 60);
		expect(processCalls).toBe(1);
	});
});

describe('onInitialize for systems added after initialize()', () => {
	test('fires onInitialize for a system added after world.initialize()', async () => {
		let initCalled = false;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
		await world.initialize();

		world.addSystem('late')
			.setOnInitialize(() => { initCalled = true; })
			.runWhenEmpty()
			.setProcess(() => {});

		expect(initCalled).toBe(false); // not yet — finalizer runs at next update

		world.update(1 / 60);
		expect(initCalled).toBe(true);
	});

	test('fires onInitialize before the system\'s first process call', async () => {
		const order: string[] = [];
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
		await world.initialize();

		world.addSystem('ordered')
			.setOnInitialize(() => { order.push('init'); })
			.runWhenEmpty()
			.setProcess(() => { order.push('process'); });

		world.update(1 / 60);
		expect(order).toEqual(['init', 'process']);
	});

	test('does not double-fire onInitialize when initialize() runs and then a system is added later', async () => {
		let earlyCalls = 0;
		let lateCalls = 0;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();

		world.addSystem('early')
			.setOnInitialize(() => { earlyCalls++; })
			.runWhenEmpty()
			.setProcess(() => {});

		await world.initialize();
		expect(earlyCalls).toBe(1);

		world.addSystem('late')
			.setOnInitialize(() => { lateCalls++; })
			.runWhenEmpty()
			.setProcess(() => {});

		world.update(1 / 60);
		expect(earlyCalls).toBe(1); // not re-fired
		expect(lateCalls).toBe(1);

		world.update(1 / 60);
		expect(earlyCalls).toBe(1);
		expect(lateCalls).toBe(1); // not re-fired across updates
	});

	test('async onInitialize on a late-added system runs', async () => {
		let resolved = false;
		const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
		await world.initialize();

		world.addSystem('lateAsync')
			.setOnInitialize(async () => {
				await Promise.resolve();
				resolved = true;
			})
			.runWhenEmpty()
			.setProcess(() => {});

		world.update(1 / 60);
		// Fire-and-forget on the late path — give the microtask a chance to run.
		await Promise.resolve();
		await Promise.resolve();
		expect(resolved).toBe(true);
	});

	test('rejected async onInitialize on a late-added system surfaces as console error, not unhandled', async () => {
		const errors: unknown[] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => { errors.push(args); };

		try {
			const world = ECSpresso.create().withComponentTypes<TestComponents>().build();
			await world.initialize();

			world.addSystem('lateBoom')
				.setOnInitialize(async () => { throw new Error('boom'); })
				.runWhenEmpty()
				.setProcess(() => {});

			world.update(1 / 60);
			await Promise.resolve();
			await Promise.resolve();

			expect(errors.length).toBeGreaterThan(0);
			const flat = errors.flat().map(String).join(' ');
			expect(flat).toContain('lateBoom');
			expect(flat).toContain('boom');
		} finally {
			console.error = originalError;
		}
	});
});
