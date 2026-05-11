import { Group, Mesh, Vector3, SphereGeometry, MeshBasicMaterial } from 'three';
import { definePlugin, collisionLayers } from '../types';
import { createGroupComponents } from '../../../src/plugins/rendering/renderer3D';
import { createSphereCollider } from '../../../src/plugins/physics/collision3D';
import {
	createTurret,
	createGroundEnemy,
	createAirEnemy,
} from '../utils';

export default function createRenderPlugin() {
	return definePlugin({
		id: 'render-plugin',
		install(world) {
			// Render sync and dispose are handled automatically by renderer3D plugin.
			// This plugin only handles game-specific rendering logic via events.

			// Model factory system
			world.addSystem('model-factory')
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

						// Create radar display (HTML overlay)
						const gameContainer = document.getElementById('game-container');
						if (gameContainer) {
							const radarContainer = document.createElement('div');
							radarContainer.id = 'radar-overlay';
							radarContainer.style.position = 'absolute';
							radarContainer.style.bottom = '20px';
							radarContainer.style.right = '20px';
							radarContainer.style.width = '150px';
							radarContainer.style.height = '150px';
							radarContainer.style.borderRadius = '50%';
							radarContainer.style.backgroundColor = 'rgba(0, 20, 0, 0.7)';
							radarContainer.style.border = '2px solid #00ff00';
							radarContainer.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.5)';
							radarContainer.style.overflow = 'hidden';
							radarContainer.style.zIndex = '100';

							// Add central point
							const centerPoint = document.createElement('div');
							centerPoint.style.position = 'absolute';
							centerPoint.style.left = '50%';
							centerPoint.style.top = '50%';
							centerPoint.style.width = '6px';
							centerPoint.style.height = '6px';
							centerPoint.style.borderRadius = '50%';
							centerPoint.style.backgroundColor = '#00ff00';
							centerPoint.style.transform = 'translate(-50%, -50%)';
							radarContainer.appendChild(centerPoint);

							// Add radar "sweep" animation
							const radarSweep = document.createElement('div');
							radarSweep.id = 'radar-sweep';
							radarSweep.style.position = 'absolute';
							radarSweep.style.left = '0';
							radarSweep.style.top = '0';
							radarSweep.style.width = '150px';
							radarSweep.style.height = '150px';
							radarSweep.style.transformOrigin = '50% 50%';
							radarSweep.style.transform = 'rotate(0deg)';
							radarSweep.style.animation = 'radar-sweep 4s linear infinite';
							radarSweep.style.zIndex = '125';
							radarSweep.style.background = 'conic-gradient(from 0deg at 50% 50%, rgba(0, 255, 0, 0) 0deg, rgba(0, 255, 0, 0.8) 30deg)';
							radarSweep.style.clipPath = 'polygon(50% 50%, 100% 0%, 50% 0%)';

							const style = document.createElement('style');
							style.textContent = `
								@keyframes radar-sweep {
									from { transform: rotate(0deg); }
									to { transform: rotate(360deg); }
								}
							`;
							document.head.appendChild(style);

							const existingStyle = document.querySelector('style');
							if (existingStyle && existingStyle !== style) {
								existingStyle.remove();
							}

							radarContainer.appendChild(radarSweep);

							// Grid lines
							const gridLine1 = document.createElement('div');
							gridLine1.style.position = 'absolute';
							gridLine1.style.left = '50%';
							gridLine1.style.top = '0';
							gridLine1.style.width = '1px';
							gridLine1.style.height = '100%';
							gridLine1.style.backgroundColor = 'rgba(0, 255, 0, 0.5)';
							gridLine1.style.transform = 'translateX(-50%)';
							radarContainer.appendChild(gridLine1);

							const gridLine2 = document.createElement('div');
							gridLine2.style.position = 'absolute';
							gridLine2.style.left = '0';
							gridLine2.style.top = '50%';
							gridLine2.style.width = '100%';
							gridLine2.style.height = '1px';
							gridLine2.style.backgroundColor = 'rgba(0, 255, 0, 0.5)';
							gridLine2.style.transform = 'translateY(-50%)';
							radarContainer.appendChild(gridLine2);

							// Circular grids
							const circleGrid = document.createElement('div');
							circleGrid.style.position = 'absolute';
							circleGrid.style.left = '50%';
							circleGrid.style.top = '50%';
							circleGrid.style.width = '100px';
							circleGrid.style.height = '100px';
							circleGrid.style.borderRadius = '50%';
							circleGrid.style.border = '1px solid rgba(0, 255, 0, 0.3)';
							circleGrid.style.transform = 'translate(-50%, -50%)';
							radarContainer.appendChild(circleGrid);

							const circleGrid2 = document.createElement('div');
							circleGrid2.style.position = 'absolute';
							circleGrid2.style.left = '50%';
							circleGrid2.style.top = '50%';
							circleGrid2.style.width = '50px';
							circleGrid2.style.height = '50px';
							circleGrid2.style.borderRadius = '50%';
							circleGrid2.style.border = '1px solid rgba(0, 255, 0, 0.3)';
							circleGrid2.style.transform = 'translate(-50%, -50%)';
							radarContainer.appendChild(circleGrid2);

							// Player direction indicator
							const playerIndicator = document.createElement('div');
							playerIndicator.id = 'player-direction';
							playerIndicator.style.position = 'absolute';
							playerIndicator.style.left = '50%';
							playerIndicator.style.top = '50%';
							playerIndicator.style.width = '0';
							playerIndicator.style.height = '0';
							playerIndicator.style.borderLeft = '8px solid transparent';
							playerIndicator.style.borderRight = '8px solid transparent';
							playerIndicator.style.borderBottom = '16px solid #00ff00';
							playerIndicator.style.transform = 'translate(-50%, -50%)';
							playerIndicator.style.zIndex = '160';
							radarContainer.appendChild(playerIndicator);

							gameContainer.appendChild(radarContainer);
							ecs.getResource('uiElements').radarElement = radarContainer;
						}
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
						const enemyEntity = ecs.spawn({
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

						// Add radar blip for this enemy (HTML based)
						const radarContainer = document.getElementById('radar-overlay');
						if (radarContainer) {
							const blip = document.createElement('div');
							blip.classList.add('radar-blip');
							blip.setAttribute('data-entity-id', enemyEntity.id.toString());
							blip.setAttribute('data-enemy-type', data.type);

							const distanceFromCenter = Math.sqrt(position.x * position.x + position.z * position.z);
							const maxDistance = 200;
							const normalizedDistance = Math.min(distanceFromCenter, maxDistance) / maxDistance;

							const radarRadius = 75;
							const blipSize = 8;
							const blipX = Math.sin(angle) * normalizedDistance * radarRadius;
							const blipZ = Math.cos(angle) * normalizedDistance * radarRadius;

							blip.style.position = 'absolute';
							blip.style.width = `${blipSize}px`;
							blip.style.height = `${blipSize}px`;
							blip.style.borderRadius = '50%';
							blip.style.backgroundColor = data.type === 'ground' ? '#ff3333' : '#3333ff';
							blip.style.left = `${50 + blipX}%`;
							blip.style.top = `${50 + blipZ}%`;
							blip.style.transform = 'translate(-50%, -50%)';
							blip.style.boxShadow = data.type === 'ground'
								? '0 0 5px #ff0000'
								: '0 0 5px #0000ff';

							radarContainer.appendChild(blip);
						}
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
						// (model cleanup is handled automatically by renderer3D's registerDispose)
						ecs.entityManager.removeEntity(data.entityId);
					}
				});
		},
	});
}
