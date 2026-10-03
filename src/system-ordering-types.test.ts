import { expect, test } from 'bun:test';
import ECSpresso, { defineSystemRef, type SystemRef, type SystemOrderingOptions } from './index';
import { createTimerPlugin, timerSystems } from './plugins/scripting/timers';
import { createCoroutinePlugin, coroutineSystems } from './plugins/scripting/coroutine';
import { createSpatialIndexPlugin } from './plugins/spatial/spatial-index';

function verifyRejectedInputs(): void {
	const system = ECSpresso.create().build().addSystem('test');
	// @ts-expect-error Diagnostic names are not references.
	system.after('timer.update');
	// @ts-expect-error Tokens cannot be fabricated from a public name.
	system.withRef({ name: 'timer.update' });
	// @ts-expect-error Ordering options accept only opaque system references.
	createTimerPlugin({ before: ['coroutine.update'] });
	// @ts-expect-error Spatial indexes only register fixedUpdate or postUpdate.
	createSpatialIndexPlugin({ ordering: { update: { after: [timerSystems.update] } } });
	const ref = defineSystemRef('immutable');
	// @ts-expect-error Reference names are immutable.
	ref.name = 'changed';
}

void verifyRejectedInputs;

test('ordering retains query/resource inference and accepts reusable references', () => {
	const ref: SystemRef = defineSystemRef('consumer');
	const options: SystemOrderingOptions = { after: [timerSystems.update] };
	const world = ECSpresso.create()
		.withComponentTypes<{ position: { x: number } }>()
		.withResource('amount', 1)
		.withPlugin(createTimerPlugin({ before: [coroutineSystems.update] }))
		.withPlugin(createCoroutinePlugin({ phase: 'preUpdate', ...options }))
		.build();
	world.addSystem('consumer')
		.withRef(ref)
		.after(timerSystems.update, coroutineSystems.update)
		.withResources(['amount'])
		.setProcessEach({ with: ['position'] }, ({ entity, resources }) => {
			const value: number = entity.components.position.x + resources.amount;
			entity.components.position.x = value;
		});
	const entity = world.spawn({ position: { x: 2 } });
	world.update(0);
	expect(entity.components.position.x).toBe(3);
});
