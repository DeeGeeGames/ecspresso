import { Group, Mesh, Vector3, SphereGeometry, MeshBasicMaterial } from 'three';
import { collisionLayers, type GameSystemRegistrar } from '../types';
import { createGroupComponents } from 'ecspresso/plugins/rendering/renderer3D';
import { createSphereCollider } from 'ecspresso/plugins/physics/collision3D';
import {
	createTurret,
	createGroundEnemy,
	createAirEnemy,
} from '../utils';

export default function registerRenderSystems(
	systems: GameSystemRegistrar,
): void {
	// Render sync and dispose are handled automatically by renderer3D plugin.
	// These application registration systems handle game-specific rendering logic via events.

	// Model factory system
	systems.addSystem('model-factory')
		.setOnDetach(() => {
			const radar = document.getElementById('radar-overlay');
			if (radar) {
				radar.hidden = true;
				for (const blip of radar.querySelectorAll('.radar-blip')) blip.remove();
			}
			const sweep = document.getElementById('radar-sweep');
			if (sweep) sweep.style.animationPlayState = 'paused';
		})
		.setEventHandlers({
			gameStart({ ecs }) {
				const turretModel = createTurret();
				// Make turret parts invisible in first-person view
				turretModel.visible = false;

				// Create player turret entity using renderer3D components
				ecs.spawn({
					...createGroupComponents(turretModel, { x: 0, y: 0, z: 0 }),
					player: {
						health: 100,
						maxHealth: 100,
						lastShotTime: 0,
						fireRate: ecs.getResource('config').playerFireRate
					},
					// Radius 7 (vs visual ~5) preserves the original AI's
					// minDistance=10 player-touch trigger once enemy radii (2–3) are added.
					...createSphereCollider(7),
					...collisionLayers.player(),
				});

				const radar = document.getElementById('radar-overlay');
				if (radar) radar.hidden = false;
				ecs.getResource('uiElements').radarElement = radar;
			},
			playerShoot({ data, ecs }) {
				const camera = ecs.getResource('camera');

				// Create projectile mesh
				const projectileGeometry = new SphereGeometry(0.25, 16, 16);
				const projectileMaterial = new MeshBasicMaterial({ color: 0xff0000 });
				const projectileMesh = new Mesh(projectileGeometry, projectileMaterial);

				const projectileGroup = new Group();
				projectileGroup.add(projectileMesh);

				const direction = data.direction || new Vector3(0, 0, -1);

				// Position in front of camera
				const spawnX = camera.position.x + direction.x * 5;
				const spawnY = camera.position.y + direction.y * 5;
				const spawnZ = camera.position.z + direction.z * 5;

				// Spawn projectile as an ECS entity with velocity and lifetime
				const projectileSpeed = 180;
				ecs.spawn({
					...createGroupComponents(projectileGroup, { x: spawnX, y: spawnY, z: spawnZ }),
					velocity: {
						x: direction.x * projectileSpeed,
						y: direction.y * projectileSpeed,
						z: direction.z * projectileSpeed,
					},
					projectile: {
						owner: 'player',
						damage: 100,
						speed: 3,
					},
					...createSphereCollider(2.5),
					...collisionLayers.projectile(),
					lifetime: {
						remaining: 3, // seconds before auto-destroy
					},
				});
			},
			enemySpawn({ data, ecs }) {
				// Create enemy model based on type
				const enemyModel = data.type === 'ground'
					? createGroundEnemy()
					: createAirEnemy();

				const position = {
					x: data.position.x,
					y: data.type === 'ground' ? 1.5 : 15,
					z: data.position.z
				};

				// Calculate rotation to face the player (center)
				const angle = Math.atan2(-position.x, -position.z);

				// Create enemy entity using renderer3D components
				ecs.spawn({
					...createGroupComponents(enemyModel, position, {
						rotation: { y: angle },
					}),
					velocity: {
						x: 0,
						y: 0,
						z: 0
					},
					enemy: {
						type: data.type,
						health: data.type === 'ground' ? 30 : 15,
						speed: data.type === 'ground' ? 12 : 18,
						attackDamage: data.type === 'ground' ? 15 : 10,
						scoreValue: data.type === 'ground' ? 100 : 150,
						isDestroying: false
					},
					...createSphereCollider(data.type === 'ground' ? 3 : 2),
					...collisionLayers.enemy(),
				});


			},
			entityDestroyed({ data, ecs }) {
				// Handle cleanup of radar blips in HTML radar
				const radarContainer = document.getElementById('radar-overlay');
				if (radarContainer) {
					const blipElement = radarContainer.querySelector(`.radar-blip[data-entity-id="${data.entityId}"]`);
					if (blipElement) {
						radarContainer.removeChild(blipElement);
					}
				}

				// Remove the entity from the ECS
				// The renderer detaches model objects; caller-owned geometry/materials stay intact.
				ecs.entityManager.removeEntity(data.entityId);
			}
		});
}
