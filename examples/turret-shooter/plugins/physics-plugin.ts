import type { GameSystemRegistrar } from '../types';

export default function registerPhysicsSystems(
	systems: GameSystemRegistrar,
): void {
	// Movement system - applies velocity to localTransform3D position
	systems.addSystem('movement')
		.inGroup('gameplay')
		.inPhase('fixedUpdate')
		.setProcessEach({ with: ['localTransform3D', 'velocity'], mutates: ['localTransform3D'] }, ({ entity, dt }) => {
			const { localTransform3D, velocity } = entity.components;
			localTransform3D.x += velocity.x * dt;
			localTransform3D.y += velocity.y * dt;
			localTransform3D.z += velocity.z * dt;
		});
}
