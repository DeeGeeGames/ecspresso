import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createLocalTransform, type TransformComponentTypes } from 'ecspresso/plugins/spatial/transform';
import type { BoundsRect } from 'ecspresso/plugins/spatial/bounds';
import { createBouncingPlugin } from './bouncing-plugin';

function createWorld() {
	return ECSpresso.create()
		.withComponentTypes<TransformComponentTypes>()
		.withResourceTypes<{ bounds: BoundsRect }>()
		.withResource('bounds', { width: 100, height: 100 })
		.withPlugin(createBouncingPlugin())
		.build();
}

// These functions are typechecked but never run: invalid composition must be rejected.
function rejectedCompositions() {
	// @ts-expect-error The renderer's transforms and bounds are requirements, not provisions.
	ECSpresso.create().withPlugin(createBouncingPlugin());
	// @ts-expect-error A component declaration alone does not satisfy the bounds requirement.
	ECSpresso.create().withComponentTypes<TransformComponentTypes>().withPlugin(createBouncingPlugin());
	// @ts-expect-error Incompatible bounds cannot satisfy the external resource contract.
	ECSpresso.create().withComponentTypes<TransformComponentTypes>().withResource('bounds', 'invalid').withPlugin(createBouncingPlugin());
}
void rejectedCompositions;

test('bouncing clamps a large step and only reflects outward velocity', async () => {
	const world = createWorld();
	await world.initialize();
	const entity = world.spawn({ ...createLocalTransform(50, 50), velocity: { x: 300, y: -300 }, radius: 10 });
	const hits: Array<{ x: number; y: number }> = [];
	world.eventBus.subscribe('wallHit', hit => hits.push(hit));
	world.update(1);
	expect(entity.components.localTransform).toMatchObject({ x: 90, y: 10 });
	expect(entity.components.velocity).toEqual({ x: -300, y: 300 });
	expect(hits).toEqual([{ x: 90, y: 10 }]);
	world.update(0);
	expect(entity.components.velocity).toEqual({ x: -300, y: 300 });
	expect(hits).toHaveLength(1);
	await world.dispose();
});

test('bounce mutations reach an immediate changed consumer, with no velocity mark on a no-op', async () => {
	const world = createWorld();
	let changed = 0;
	world.addSystem('velocity-observer')
		.setPriority(-100)
		.setProcessEach({ with: ['velocity'], changed: ['velocity'], mutates: [] }, () => { changed++; });
	await world.initialize();
	world.spawn({ ...createLocalTransform(50, 50), velocity: { x: 100, y: 0 }, radius: 10 });
	world.update(0);
	changed = 0;
	world.update(1);
	expect(changed).toBe(1);
	changed = 0;
	world.update(0);
	expect(changed).toBe(0);
	await world.dispose();
});
