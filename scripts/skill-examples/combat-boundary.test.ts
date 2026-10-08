import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createHealthPlugin } from 'ecspresso/plugins/combat/health';
import {
	createProjectilePlugin, createProjectile, createProjectileTarget,
} from 'ecspresso/plugins/combat/projectile';
import {
	createCollisionPlugin, defineCollisionLayers, createCircleCollider, collisionSystems,
} from 'ecspresso/plugins/physics/collision';
import { createTransformPlugin, createTransform } from 'ecspresso/plugins/spatial/transform';

test('collision delivers damage and removal becomes visible after postUpdate', async () => {
	const layers = defineCollisionLayers({ shot: ['target'], target: ['shot'] });
	const world = ECSpresso.create()
		.withFixedTimestep(0.1)
		.withPlugin(createTransformPlugin())
		.withPlugin(createCollisionPlugin({ layers }))
		.withPlugin(createHealthPlugin())
		.withPlugin(createProjectilePlugin<'combat', keyof typeof layers>({ phase: 'fixedUpdate' }))
		.build();
	const hits: number[] = [];
	const deaths: number[] = [];
	world.addSystem('death-response').setEventHandlers({
		projectileHit({ data }) { hits.push(data.targetId); },
		entityDied({ data, ecs }) {
			expect(ecs.getComponent(data.entityId, 'health')?.current).toBe(0);
			deaths.push(data.entityId);
			ecs.commands.removeEntity(data.entityId); // Application-owned death policy.
		},
	});
	try {
		await world.initialize();
		const source = world.spawn({});
		const target = world.spawn({
			...createTransform(10, 0), ...createCircleCollider(1), ...layers.target(),
			health: { current: 5, max: 5 },
		});
		const shot = world.spawn({
			...createTransform(0, 0), ...createCircleCollider(1), ...layers.shot(),
			...createProjectile(5, 100, source.id), ...createProjectileTarget(target.id),
		});
		const visibility: string[] = [];
		world.addSystem('before-playback').inPhase('postUpdate').after(collisionSystems.detect)
			.setProcess(({ ecs }) => {
				if (deaths.length === 0) return;
				expect(ecs.getEntity(target.id)).toBeDefined();
				expect(ecs.getEntity(shot.id)).toBeDefined();
				visibility.push('queued');
			});
		world.addSystem('after-playback').inPhase('render').setProcess(({ ecs }) => {
			if (deaths.length === 0) return;
			expect(ecs.getEntity(target.id)).toBeUndefined();
			expect(ecs.getEntity(shot.id)).toBeUndefined();
			visibility.push('removed');
		});
		world.update(0.05); // No fixed step yet; establish baseline world transforms.
		expect(shot.components.localTransform.x).toBe(0);
		expect(hits).toEqual([]);
		world.update(0.05); // Accumulated 0.1s: one homing step reaches the target.
		expect(hits).toEqual([target.id]);
		expect(deaths).toEqual([target.id]);
		expect(visibility).toEqual(['queued', 'removed']);
	} finally {
		await world.dispose();
	}
});
