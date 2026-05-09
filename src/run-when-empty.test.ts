import { expect, describe, test } from 'bun:test';
import ECSpresso from './ecspresso';
import type { WorldConfigFrom } from './type-utils';

interface TestComponents {
	position: { x: number; y: number };
	velocity: { dx: number; dy: number };
	health: { hp: number };
}

describe('runWhenEmpty', () => {
	describe('default behavior (runWhenEmpty not set)', () => {
		test('system with queries and no matching entities is skipped', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('movement')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.setProcess(() => { ran = true; });

			world.update(1 / 60);

			expect(ran).toBe(false);
		});

		test('system without queries always runs', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('noQuery')
				.setProcess(() => { ran = true; });

			world.update(1 / 60);

			expect(ran).toBe(true);
		});
	});

	describe('runWhenEmpty enabled', () => {
		test('system with queries and no matching entities still runs', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.runWhenEmpty()
				.setProcess(() => { ran = true; });

			world.update(1 / 60);

			expect(ran).toBe(true);
		});

		test('receives empty arrays for each query, not undefined', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let receivedQueries: Record<string, unknown[]> | undefined;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.runWhenEmpty()
				.setProcess(({ queries }) => {
					receivedQueries = queries as unknown as Record<string, unknown[]>;
				});

			world.update(1 / 60);

			expect(receivedQueries).toBeDefined();
			expect(receivedQueries!['movers']).toBeArrayOfSize(0);
		});

		test('runs normally when entities match', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let count = 0;

			world.addSystem('movement')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.runWhenEmpty()
				.setProcess(({ queries }) => { count = queries.movers.length; });

			world.spawn({ position: { x: 0, y: 0 }, velocity: { dx: 1, dy: 1 } });
			world.spawn({ position: { x: 5, y: 5 }, velocity: { dx: 2, dy: 2 } });
			world.update(1 / 60);

			expect(count).toBe(2);
		});

		test('runs when all of multiple queries are empty', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('multiQuery')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.addQuery('living', { with: ['health'] as const })
				.runWhenEmpty()
				.setProcess(() => { ran = true; });

			world.update(1 / 60);

			expect(ran).toBe(true);
		});

		test('multiple queries all receive empty arrays', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let receivedQueries: Record<string, unknown[]> | undefined;

			world.addSystem('multiQuery')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.addQuery('living', { with: ['health'] as const })
				.runWhenEmpty()
				.setProcess(({ queries }) => {
					receivedQueries = queries as unknown as Record<string, unknown[]>;
				});

			world.update(1 / 60);

			expect(receivedQueries).toBeDefined();
			expect(receivedQueries!['movers']).toBeArrayOfSize(0);
			expect(receivedQueries!['living']).toBeArrayOfSize(0);
		});
	});

	describe('diagnostics compatibility', () => {
		test('runs with diagnostics enabled and empty queries', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.runWhenEmpty()
				.setProcess(() => { ran = true; });

			world.enableDiagnostics(true);
			world.update(1 / 60);

			expect(ran).toBe(true);
		});

		test('timing is recorded when running with empty queries', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.runWhenEmpty()
				.setProcess(() => {});

			world.enableDiagnostics(true);
			world.update(1 / 60);

			expect(world.systemTimings.has('spawner')).toBe(true);
		});

		test('timing is NOT recorded when system is skipped due to empty queries', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();

			world.addSystem('skipped')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.setProcess(() => {});

			world.enableDiagnostics(true);
			world.update(1 / 60);

			expect(world.systemTimings.has('skipped')).toBe(false);
		});
	});

	describe('change detection interaction', () => {
		test('system last-seen sequence updates when running with empty queries', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let callCount = 0;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position', 'velocity'] as const })
				.runWhenEmpty()
				.setProcess(() => { callCount++; });

			world.update(1 / 60);
			world.update(1 / 60);

			expect(callCount).toBe(2);
		});
	});

	describe('builder chaining', () => {
		test('chains with inPhase()', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position'] as const })
				.runWhenEmpty()
				.inPhase('preUpdate')
				.setProcess(() => { ran = true; });

			world.update(1 / 60);

			expect(ran).toBe(true);
		});

		test('chains with inGroup()', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position'] as const })
				.runWhenEmpty()
				.inGroup('spawning')
				.setProcess(() => { ran = true; });

			world.update(1 / 60);

			expect(ran).toBe(true);
			expect(world.getSystemsInGroup('spawning')).toEqual(['spawner']);
		});

		test('system registered and runs via update()', () => {
			const world = new ECSpresso<WorldConfigFrom<TestComponents>>();
			let ran = false;

			world.addSystem('spawner')
				.addQuery('movers', { with: ['position'] as const })
				.runWhenEmpty()
				.setProcess(() => { ran = true; });
			world.update(1 / 60);

			expect(ran).toBe(true);
		});
	});
});
