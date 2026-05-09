import { definePlugin, type World } from '../types';
import { spawnProjectileAt } from '../utils';

function findNearestLiveTarget(
	detectedEntities: { entities: readonly { entityId: number; distanceSq: number }[] },
	ecs: World,
): { entityId: number; x: number; y: number } | undefined {
	for (const entry of detectedEntities.entities) {
		const entity = ecs.getEntity(entry.entityId);
		if (!entity) continue;

		const transform = ecs.getComponent(entry.entityId, 'worldTransform');
		if (!transform) continue;

		return { entityId: entry.entityId, x: transform.x, y: transform.y };
	}
	return undefined;
}

export default function createTurretPlugin() {
	return definePlugin({
		id: 'turret-plugin',
		install(world) {
			// Aim turret toward nearest detected enemy
			world
				.addSystem('turret-aim')
				.inGroup('gameplay')
				.setPriority(600)
				.setProcessEach({ with: ['turret', 'localTransform', 'detectedEntities'] }, ({ entity, ecs }) => {
					const { localTransform, detectedEntities } = entity.components;
					const target = findNearestLiveTarget(detectedEntities, ecs as World);
					if (!target) return;

					const dx = target.x - localTransform.x;
					const dy = target.y - localTransform.y;
					// Offset by PI/2 so barrel (drawn pointing up) faces the target
					localTransform.rotation = Math.atan2(dy, dx) + Math.PI / 2;
					ecs.markChanged(entity.id, 'localTransform');
				});

			// Fire projectiles on timer tick when targets are available
			world
				.addSystem('turret-fire')
				.inGroup('gameplay')
				.setPriority(700)
				.setProcessEach({ with: ['turret', 'localTransform', 'detectedEntities', 'timers'] }, ({ entity, ecs }) => {
					const { timers, localTransform, detectedEntities } = entity.components;
					if (!timers['fire']?.justFinished) return;

					const target = findNearestLiveTarget(detectedEntities, ecs as World);
					if (!target) return;

					spawnProjectileAt(
						ecs as World,
						localTransform.x,
						localTransform.y,
						target.entityId,
						entity.id,
					);
				});
		},
	});
}
