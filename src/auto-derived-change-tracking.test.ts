import { describe, test, expect } from 'bun:test';
import ECSpresso from './ecspresso';

interface TestComponents {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
}

describe('Auto-derived change tracking', () => {
	test('default (no changed: filter anywhere) tracks everything', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.build();
		const e = ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.update(0);

		ecs.markChanged(e.id, 'position');
		const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
		expect(visible.length).toBe(1);
	});

	test('system with changed: filter auto-subscribes that component', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.build();

		ecs.addSystem('reader')
			.addQuery('entities', {
				with: ['position'] as const,
				changed: ['position'] as const,
			})
			.setProcess(() => {});

		const e = ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.update(0);

		ecs.markChanged(e.id, 'position');
		const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
		expect(visible.length).toBe(1);
	});

	test('once any system subscribes, other components become no-ops', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.build();

		ecs.addSystem('reader')
			.addQuery('entities', {
				with: ['position'] as const,
				changed: ['position'] as const,
			})
			.setProcess(() => {});

		const e = ecs.spawn({ velocity: { x: 1, y: 0 } });
		ecs.update(0);

		// 'velocity' was never subscribed (no changed: filter for it), so
		// the mark is dropped and the changed query returns nothing.
		ecs.markChanged(e.id, 'velocity');
		const visible = ecs.getEntitiesWithQuery(['velocity'], [], ['velocity']);
		expect(visible.length).toBe(0);
	});

	test('disableChangeTracking drops all marks when no subscriptions exist', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.disableChangeTracking()
			.build();

		const e = ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.update(0);

		ecs.markChanged(e.id, 'position');
		const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
		expect(visible.length).toBe(0);
	});

	test('disableChangeTracking still honors explicit changed: subscriptions', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.disableChangeTracking()
			.build();

		ecs.addSystem('reader')
			.addQuery('entities', {
				with: ['position'] as const,
				changed: ['position'] as const,
			})
			.setProcess(() => {});

		const e = ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.update(0);

		// 'position' is subscribed via the system's changed: filter, so it tracks.
		ecs.markChanged(e.id, 'position');
		const positionVisible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
		expect(positionVisible.length).toBe(1);

		// 'velocity' has no subscriber, so it's dropped even on a fresh entity.
		const e2 = ecs.spawn({ velocity: { x: 1, y: 0 } });
		ecs.update(0);
		ecs.markChanged(e2.id, 'velocity');
		const velocityVisible = ecs.getEntitiesWithQuery(['velocity'], [], ['velocity']);
		expect(velocityVisible.length).toBe(0);
	});

	test('command buffer markChanged respects auto-derivation', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<TestComponents>()
			.disableChangeTracking()
			.build();

		const e = ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.update(0);

		ecs.commands.markChanged(e.id, 'position');
		ecs.commands.playback(ecs);

		// No subscriber for 'position' → command-buffered mark is also a no-op.
		const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
		expect(visible.length).toBe(0);
	});
});
