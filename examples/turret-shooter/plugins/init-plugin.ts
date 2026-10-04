import type { Object3D } from 'three';
import type { GameSystemRegistrar } from '../types';
import { createGround, createSkybox, createUIElement, setupLighting } from '../utils';

export default function registerInitSystems(
	systems: GameSystemRegistrar,
): void {
	const ownedUI: HTMLElement[] = [];
	systems.addSystem('init')
		.setOnInitialize((ecs) => {
			// Add a reticle/crosshair for aiming
			const reticle = document.createElement('div');
			reticle.id = 'reticle';
			ownedUI.push(reticle);
			reticle.style.position = 'absolute';
			reticle.style.top = '50%';
			reticle.style.left = '50%';
			reticle.style.transform = 'translate(-50%, -50%)';
			reticle.style.width = '20px';
			reticle.style.height = '20px';
			reticle.style.borderRadius = '50%';
			reticle.style.border = '2px solid white';
			reticle.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
			reticle.style.pointerEvents = 'none';
			reticle.style.zIndex = '1000';

			const centerDot = document.createElement('div');
			centerDot.style.position = 'absolute';
			centerDot.style.top = '50%';
			centerDot.style.left = '50%';
			centerDot.style.transform = 'translate(-50%, -50%)';
			centerDot.style.width = '4px';
			centerDot.style.height = '4px';
			centerDot.style.borderRadius = '50%';
			centerDot.style.backgroundColor = 'red';
			reticle.appendChild(centerDot);

			document.getElementById('game-container')?.appendChild(reticle);

			ecs.disableSystemGroup('gameplay');
			ecs.disableSystemGroup('timers');

			// Initialize assets object
			const assets: { models: Record<string, Object3D>; textures: Record<string, unknown> } = {
				models: {},
				textures: {}
			};

			// Add static scene objects as entities — auto-added to scene by renderer3D plugin
			const ground = createGround();
			ecs.spawn({ group: ground, localTransform3D: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } });

			const skybox = createSkybox();
			ecs.spawn({ mesh: skybox, localTransform3D: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } });

			// Setup lighting directly on the scene (lights aren't typically ECS entities)
			const scene = ecs.getResource('scene');
			setupLighting(scene);

			// Create UI elements
			const scoreElement = createUIElement('score', 'Score: 0', '20px', '20px');
			const healthElement = createUIElement('health', 'Health: 100/100', '20px', '60px');
			const waveElement = createUIElement('wave', 'Wave: 1', '20px', '100px');
			const messageElement = createUIElement('message', 'READY', '50%', '25%');
			messageElement.style.transform = 'translate(-50%, -50%)';
			messageElement.style.fontSize = '32px';
			messageElement.style.opacity = '0';
			ownedUI.push(scoreElement, healthElement, waveElement, messageElement);

			// Initialize resources
			ecs
				.addResource('assets', assets)
				.addResource('simulationClock', { elapsed: 0 })
				.addResource('gameState', {
					status: 'ready',
					wave: 1,
					score: 0
				})
				.addResource('input', {
					mousePosition: { x: 0, y: 0 },
					mouseButtons: { left: false, right: false, middle: false },
					keys: {},
					aim: { x: 0, y: 0 },
					aimDirty: false,
					shotRequested: false
				})
				.addResource('config', {
					playerFireRate: 10,
					playerProjectileSpeed: 0.03,
					playerProjectileDamage: 100,
					maxEnemies: 20,
					enemySpawnRate: 1,
					waveCount: 5,
					enemiesPerWave: 15
				})
				.addResource('waveManager', {
					currentWave: 1,
					enemiesRemaining: 15,
					waveStartTime: 0
				})
				.addResource('uiElements', {
					scoreElement,
					healthElement,
					waveElement,
					messageElement,
					radarElement: null
				})
				.addResource('radar', {
					range: 100,
					updateFrequency: 0.5,
					lastUpdateTime: 0
				});
		})
		.setOnDetach(() => {
			for (const element of ownedUI) element.remove();
			ownedUI.length = 0;
		})
		.setEventHandlers({
			gameInit({ ecs }) {
				// Show ready message
				const uiElements = ecs.getResource('uiElements');
				if (uiElements.messageElement) {
					uiElements.messageElement.style.top = '25%';
					uiElements.messageElement.style.opacity = '1';
					ecs.spawn({ startup: { remaining: 2, hidden: false } });
				}
			},
		});
	systems.addSystem('startup')
		.setProcessEach({ with: ['startup'], mutates: ['startup'] }, ({ entity, dt, ecs }) => {
			const startup = entity.components.startup;
			startup.remaining -= dt;
			if (startup.remaining > 0) return;
			if (!startup.hidden) {
				const message = ecs.getResource('uiElements').messageElement;
				if (message) message.style.opacity = '0';
				startup.hidden = true;
				startup.remaining = 0.5;
				return;
			}
			ecs.removeEntity(entity.id);
			ecs.eventBus.publish('gameStart', true);
		});
}
