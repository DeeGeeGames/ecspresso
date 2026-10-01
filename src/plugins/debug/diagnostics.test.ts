import { describe, test, expect } from 'bun:test';
import ECSpresso from '../../ecspresso';
import type { WorldConfigFrom } from '../../type-utils';
import {
	createDiagnosticsPlugin,
	type DiagnosticsData,
} from './diagnostics';

// ==================== Test Helpers ====================

interface TestComponents {
	position: { x: number; y: number };
	health: { current: number };
}

interface TestEvents {}
interface TestResources {}

function createTestEcs() {
	return ECSpresso
		.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
		.withPlugin(createDiagnosticsPlugin())
		.build();
}

function getDiagnostics(ecs: { getResource(key: 'diagnostics'): DiagnosticsData }): DiagnosticsData {
	return ecs.getResource('diagnostics');
}

// ==================== Tests ====================

describe('Diagnostics Plugin', () => {
	test('plugin installs and provides diagnostics resource', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		const d = getDiagnostics(ecs);
		expect(d).toBeDefined();
		expect(d.fps).toBe(0);
		expect(d.entityCount).toBe(0);
		expect(d.averageFrameTime).toBe(0);
	});

	test('onInitialize enables diagnostics', async () => {
		const ecs = createTestEcs();
		expect(ecs.diagnosticsEnabled).toBe(false);

		await ecs.initialize();
		expect(ecs.diagnosticsEnabled).toBe(true);
	});

	test('enableTimingOnInit: false does not enable diagnostics', async () => {
		const ecs = ECSpresso
			.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
			.withPlugin(createDiagnosticsPlugin({ enableTimingOnInit: false }))
			.build();

		await ecs.initialize();
		expect(ecs.diagnosticsEnabled).toBe(false);
	});

	test('onDetach disables diagnostics', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();
		expect(ecs.diagnosticsEnabled).toBe(true);

		ecs.removeSystem('diagnostics-collect');
		expect(ecs.diagnosticsEnabled).toBe(false);
	});

	test('entity count reflects spawns and removals', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.spawn({ position: { x: 1, y: 1 } });
		const e3 = ecs.spawn({ health: { current: 100 } });

		ecs.update(1 / 60);

		expect(getDiagnostics(ecs).entityCount).toBe(3);

		ecs.removeEntity(e3.id);
		ecs.update(1 / 60);

		expect(getDiagnostics(ecs).entityCount).toBe(2);
	});

	test('FPS converges after N frames at constant dt', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		// Simulate 120 frames at 60fps
		for (let i = 0; i < 120; i++) {
			ecs.update(1 / 60);
		}

		const d = getDiagnostics(ecs);
		// FPS is computed from performance.now() timestamps, not dt,
		// so it reflects real wall-clock time. We just check it's a positive number.
		expect(d.fps).toBeGreaterThan(0);
		expect(d.averageFrameTime).toBeGreaterThan(0);
	});

	test('system timings map is populated when diagnostics enabled', async () => {
		const ecs = ECSpresso
			.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
			.withPlugin(createDiagnosticsPlugin())
			.build();

		// Add a system that does work
		ecs.addSystem('test-system')
			.inPhase('update')
			.setProcess(() => {
				// Simulate some work
				let sum = 0;
				for (let i = 0; i < 1000; i++) sum += i;
			});

		await ecs.initialize();
		ecs.update(1 / 60);

		const timings = ecs.systemTimings;
		expect(timings.has('test-system')).toBe(true);
		expect(timings.has('diagnostics-collect')).toBe(true);
		expect(timings.get('test-system')).toBeGreaterThanOrEqual(0);
	});

	test('system timings map is empty when diagnostics disabled', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		// Run a frame to populate timings
		ecs.update(1 / 60);
		expect(ecs.systemTimings.size).toBeGreaterThan(0);

		// Disable diagnostics
		ecs.enableDiagnostics(false);
		expect(ecs.systemTimings.size).toBe(0);
	});

	test('phase timings are populated when diagnostics enabled', async () => {
		const ecs = ECSpresso
			.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
			.withPlugin(createDiagnosticsPlugin())
			.build();

		ecs.addSystem('pre-system')
			.inPhase('preUpdate')
			.setProcess(() => {});

		await ecs.initialize();
		ecs.update(1 / 60);

		const phases = ecs.phaseTimings;
		// All phases should have non-negative values
		expect(phases.preUpdate).toBeGreaterThanOrEqual(0);
		expect(phases.fixedUpdate).toBeGreaterThanOrEqual(0);
		expect(phases.update).toBeGreaterThanOrEqual(0);
		expect(phases.postUpdate).toBeGreaterThanOrEqual(0);
		expect(phases.render).toBeGreaterThanOrEqual(0);
	});

	test('phase timings are zero when diagnostics disabled', async () => {
		const ecs = createTestEcs();
		// Don't initialize (so diagnostics won't auto-enable)
		// Instead, manually test the disabled state
		ecs.update(1 / 60);

		const phases = ecs.phaseTimings;
		expect(phases.preUpdate).toBe(0);
		expect(phases.update).toBe(0);
		expect(phases.render).toBe(0);
	});

	test('disabling system group stops resource updates', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.update(1 / 60);
		expect(getDiagnostics(ecs).entityCount).toBe(1);

		// Disable the diagnostics group
		ecs.disableSystemGroup('diagnostics');

		// Spawn more entities, update, but diagnostics should not be collected
		ecs.spawn({ position: { x: 1, y: 1 } });
		ecs.spawn({ position: { x: 2, y: 2 } });
		ecs.update(1 / 60);

		// Entity count in diagnostics should still show 1 from the last update
		expect(getDiagnostics(ecs).entityCount).toBe(1);

		// Re-enable and verify it catches up
		ecs.enableSystemGroup('diagnostics');
		ecs.update(1 / 60);
		expect(getDiagnostics(ecs).entityCount).toBe(3);
	});

	test('entityCount getter on ECSpresso delegates to entity manager', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		expect(ecs.entityCount).toBe(0);

		ecs.spawn({ position: { x: 0, y: 0 } });
		expect(ecs.entityCount).toBe(1);

		const e2 = ecs.spawn({ health: { current: 50 } });
		expect(ecs.entityCount).toBe(2);

		ecs.removeEntity(e2.id);
		expect(ecs.entityCount).toBe(1);
	});

	test('custom fpsSampleCount works', async () => {
		const ecs = ECSpresso
			.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
			.withPlugin(createDiagnosticsPlugin({ fpsSampleCount: 10 }))
			.build();

		await ecs.initialize();

		// Run 20 frames
		for (let i = 0; i < 20; i++) {
			ecs.update(1 / 60);
		}

		const d = getDiagnostics(ecs);
		expect(d.fps).toBeGreaterThan(0);
	});

	test('custom system group name', async () => {
		const ecs = ECSpresso
			.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
			.withPlugin(createDiagnosticsPlugin({ systemGroup: 'debug' }))
			.build();

		await ecs.initialize();

		expect(ecs.getSystemsInGroup('debug')).toContain('diagnostics-collect');
		expect(ecs.getSystemsInGroup('diagnostics')).not.toContain('diagnostics-collect');
	});

	test('diagnostics resource reflects system timings from ecs', async () => {
		const ecs = createTestEcs();
		await ecs.initialize();

		ecs.update(1 / 60);

		const d = getDiagnostics(ecs);
		// The diagnostics resource should contain the same timings as the ecs
		expect(d.systemTimings).toBe(ecs.systemTimings);
		expect(d.phaseTimings).toBe(ecs.phaseTimings);
	});
});

test('reused diagnostics plugin isolates resources and frame history', async () => {
	const plugin = createDiagnosticsPlugin({ fpsSampleCount: 3 });
	const a = ECSpresso.create().withPlugin(plugin).build();
	const b = ECSpresso.create().withPlugin(plugin).build();
	await a.initialize();
	await b.initialize();
	a.spawn({});
	a.update(0.016);
	a.update(0.016);
	const dataA = a.getResource('diagnostics');
	const dataB = b.getResource('diagnostics');
	expect(dataA).not.toBe(dataB);
	expect(dataA.entityCount).toBe(1);
	expect(dataB.entityCount).toBe(0);
	b.update(0.016);
	expect(dataB.fps).toBe(0);
	expect(dataA.entityCount).toBe(1);
	await a.dispose();
	await b.dispose();
});
