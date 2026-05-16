import { describe, test, expect } from 'bun:test';
import ECSpresso from './ecspresso';

interface TestComponents {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
}

describe('Typed change tracking', () => {
	describe('default behavior (no setTrackedChanges)', () => {
		test('markChanged records for any component (default = all tracked)', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 } });
			ecs.update(0);

			ecs.markChanged(e.id, 'position');
			const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
			expect(visible.length).toBe(1);
		});

		test('markChangedIfTracked records when tracked (default = all)', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 } });
			ecs.update(0);

			ecs.markChangedIfTracked(e.id, 'position');
			const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
			expect(visible.length).toBe(1);
		});
	});

	describe('narrowed tracking via setTrackedChanges', () => {
		test('markChanged records for declared components', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 } });
			ecs.update(0);

			ecs.markChanged(e.id, 'position');
			const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
			expect(visible.length).toBe(1);
		});

		test('markChangedIfTracked is a no-op for undeclared components', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ velocity: { x: 1, y: 0 } });
			ecs.update(0);

			ecs.markChangedIfTracked(e.id, 'velocity');
			const visible = ecs.getEntitiesWithQuery(['velocity'], [], ['velocity']);
			expect(visible.length).toBe(0);
		});

		test('markChangedIfTracked records for declared components', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 } });
			ecs.update(0);

			ecs.markChangedIfTracked(e.id, 'position');
			const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
			expect(visible.length).toBe(1);
		});

		test('setTrackedChanges() with no args tracks nothing', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges()
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 } });
			ecs.update(0);

			ecs.markChangedIfTracked(e.id, 'position');
			const visible = ecs.getEntitiesWithQuery(['position'], [], ['position']);
			expect(visible.length).toBe(0);
		});
	});

	describe('type narrowing', () => {
		test('markChanged on undeclared component is a compile error', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ velocity: { x: 1, y: 0 } });

			ecs.markChanged(e.id, 'position');
			// @ts-expect-error 'velocity' is not in trackedChanges
			ecs.markChanged(e.id, 'velocity');
			expect(true).toBe(true);
		});

		test('changed: in query rejects undeclared components', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();

			ecs.addSystem('s1')
				.addQuery('q', { with: ['position'], changed: ['position'] })
				.setProcess(() => {});

			const s2 = ecs.addSystem('s2');
			// @ts-expect-error 'velocity' is not in trackedChanges
			s2.addQuery('q', { with: ['velocity'], changed: ['velocity'] })
				.setProcess(() => {});
			expect(true).toBe(true);
		});

		test('markChangedIfTracked accepts any component name', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ velocity: { x: 1, y: 0 }, health: { value: 100 } });

			ecs.markChangedIfTracked(e.id, 'position');
			ecs.markChangedIfTracked(e.id, 'velocity');
			ecs.markChangedIfTracked(e.id, 'health');
			expect(true).toBe(true);
		});
	});

	describe('runtime optimization', () => {
		test('marks on untracked components do not advance changeThreshold', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 } });
			ecs.update(0);

			const seqBefore = ecs.entityManager.changeSeq;
			for (let i = 0; i < 100; i++) ecs.markChangedIfTracked(e.id, 'velocity');
			const seqAfter = ecs.entityManager.changeSeq;
			expect(seqAfter).toBe(seqBefore);
		});

		test('marks on tracked components advance changeThreshold', () => {
			const ecs = ECSpresso.create()
				.withComponentTypes<TestComponents>()
				.setTrackedChanges('position')
				.build();
			const e = ecs.spawn({ position: { x: 0, y: 0 } });
			ecs.update(0);

			const seqBefore = ecs.entityManager.changeSeq;
			ecs.markChanged(e.id, 'position');
			const seqAfter = ecs.entityManager.changeSeq;
			expect(seqAfter).toBeGreaterThan(seqBefore);
		});
	});
});
