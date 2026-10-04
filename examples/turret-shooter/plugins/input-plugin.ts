import { Vector3, Euler, Quaternion } from 'three';
import type { GameSystemRegistrar } from '../types';

export default function registerInputSystems(
	systems: GameSystemRegistrar,
): void {
	systems.addSystem('input-handler')
		.setOnInitialize((ecs) => {
			// Track mouse movement for camera rotation
			let mouseX = 0;
			let mouseY = 0;
			let targetRotationY = 0; // Horizontal rotation (around Y axis)
			let targetRotationX = 0; // Vertical rotation (around X axis)
			const verticalLimit = Math.PI / 2; // 90 degrees limit

			// Lock pointer for first-person control
			const lockPointer = () => {
				const container = document.getElementById('game-container');
				if (container) {
					container.requestPointerLock();
				}
			};

			// Handle pointer lock change
			const onPointerLockChange = () => {
				const isLocked = document.pointerLockElement === document.getElementById('game-container');
				if (isLocked && ecs.getResource('gameState').status === 'playing') {
					// Pointer is locked, enable mouse movement
				} else {
					// Pointer is unlocked, pause game if playing
					if (ecs.getResource('gameState').status === 'playing') {
						ecs.eventBus.publish('gamePause', true);
					}
				}
			};

			// Mouse movement handling for first-person view
			const onMouseMove = (event: MouseEvent) => {
				// Only process if game is playing
				if (ecs.getResource('gameState').status !== 'playing') return;

				// Check if pointer is locked
				if (document.pointerLockElement === document.getElementById('game-container')) {
					// Update based on mouse movement deltas (for pointer lock)
					mouseX += event.movementX * 0.002; // Adjust sensitivity
					mouseY -= event.movementY * 0.002;

					// Limit vertical rotation to prevent flipping
					mouseY = Math.max(-verticalLimit, Math.min(verticalLimit * 0.8, mouseY));

					// Update target rotations
					targetRotationY = -mouseX; // Horizontal rotation
					targetRotationX = mouseY; // Vertical rotation

					const input = ecs.getResource('input');
					input.aim.x = targetRotationX;
					input.aim.y = targetRotationY;
					input.aimDirty = true;
					ecs.eventBus.publish('inputMouseMove', { x: mouseX, y: mouseY });
				} else {
					// Update mouse position for regular cursor
					const input = ecs.getResource('input');
					input.mousePosition.x = event.clientX;
					input.mousePosition.y = event.clientY;
				}
			};

			// Mouse button handling
			const onMouseDown = (event: MouseEvent) => {
				// Update mouse button state
				const input = ecs.getResource('input');
				if (event.button === 0) input.mouseButtons.left = true;
				if (event.button === 1) input.mouseButtons.middle = true;
				if (event.button === 2) input.mouseButtons.right = true;

				// Lock pointer on click if game is active
				if (ecs.getResource('gameState').status === 'playing' &&
					document.pointerLockElement !== document.getElementById('game-container')) {
					lockPointer();
					return;
				}

				// Fire on left click if game is active and pointer is locked
				if (event.button === 0 &&
					ecs.getResource('gameState').status === 'playing' &&
					document.pointerLockElement === document.getElementById('game-container')) {
					ecs.getResource('input').shotRequested = true;
				}

				// Publish mouse down event
				ecs.eventBus.publish('inputMouseDown', {
					button: event.button
				});
			};

			const onMouseUp = (event: MouseEvent) => {
				// Update mouse button state
				const input = ecs.getResource('input');
				if (event.button === 0) input.mouseButtons.left = false;
				if (event.button === 1) input.mouseButtons.middle = false;
				if (event.button === 2) input.mouseButtons.right = false;

				// Publish mouse up event
				ecs.eventBus.publish('inputMouseUp', {
					button: event.button
				});
			};

			// Keyboard handling
			const onKeyDown = (event: KeyboardEvent) => {
				const input = ecs.getResource('input');
				input.keys[event.key] = true;

				// Handle game state changes
				if (event.key === 'p' || event.key === 'Escape') {
					const gameState = ecs.getResource('gameState');
					if (gameState.status === 'playing') {
						ecs.eventBus.publish('gamePause', true);
						// Exit pointer lock
						document.exitPointerLock();
					} else if (gameState.status === 'paused') {
						ecs.eventBus.publish('gameResume', true);
						// Lock pointer again
						lockPointer();
					}
				}

				// Handle shooting with space
				if (event.key === ' ' && ecs.getResource('gameState').status === 'playing') {
					ecs.getResource('input').shotRequested = true;
				}

				// Publish key down event
				ecs.eventBus.publish('inputKeyDown', {
					key: event.key
				});
			};

			const onKeyUp = (event: KeyboardEvent) => {
				const input = ecs.getResource('input');
				input.keys[event.key] = false;

				// Publish key up event
				ecs.eventBus.publish('inputKeyUp', {
					key: event.key
				});
			};

			// Disable context menu on right-click
			const onContextMenu = (event: MouseEvent) => {
				event.preventDefault();
				return false;
			};

			// Register event listeners
			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mousedown', onMouseDown);
			window.addEventListener('mouseup', onMouseUp);
			window.addEventListener('keydown', onKeyDown);
			window.addEventListener('keyup', onKeyUp);
			window.addEventListener('contextmenu', onContextMenu);

			const container = document.getElementById('game-container');
			const onContainerClick = () => {
				if (ecs.getResource('gameState').status === 'playing' && document.pointerLockElement !== container) lockPointer();
			};
			document.addEventListener('pointerlockchange', onPointerLockChange);
			container?.addEventListener('click', onContainerClick);
			ecs.addResource('eventListeners', {
				mousemove: onMouseMove, mousedown: onMouseDown, mouseup: onMouseUp,
				keydown: onKeyDown, keyup: onKeyUp, contextmenu: onContextMenu,
				pointerlockchange: onPointerLockChange, containerClick: onContainerClick, container,
			});
		})
		.setOnDetach((ecs) => {
			// Clean up event listeners when system is detached
			const listeners = ecs.getResource('eventListeners');

			window.removeEventListener('mousemove', listeners.mousemove);
			window.removeEventListener('mousedown', listeners.mousedown);
			window.removeEventListener('mouseup', listeners.mouseup);
			window.removeEventListener('keydown', listeners.keydown);
			window.removeEventListener('keyup', listeners.keyup);
			window.removeEventListener('contextmenu', listeners.contextmenu);

			document.removeEventListener('pointerlockchange', listeners.pointerlockchange);
			listeners.container?.removeEventListener('click', listeners.containerClick);

			// Exit pointer lock if active
			if (document.pointerLockElement) {
				document.exitPointerLock();
			}
		});
	registerInputSimulationSystems(systems);
}

export function registerInputSimulationSystems(systems: GameSystemRegistrar): void {
	// These are application systems registered on an existing world, not plugins.
	systems.addSystem('aiming')
		.inGroup('gameplay')
		.withResources(['input', 'camera'])
		.setProcessEach({ with: ['player', 'localTransform3D'], mutates: ['localTransform3D'] }, ({ entity, resources: { input, camera } }) => {
			if (!input.aimDirty) return false;
			entity.components.localTransform3D.rx = input.aim.x;
			entity.components.localTransform3D.ry = input.aim.y;
			camera.quaternion.setFromEuler(new Euler(input.aim.x, input.aim.y, 0, 'YXZ'));
			input.aimDirty = false;
		});

	systems.addSystem('firing')
		.inGroup('gameplay')
		.withResources(['input'])
		.setProcessEach({ with: ['player', 'localTransform3D'], mutates: ['player'] }, ({ entity, dt, ecs, resources: { input } }) => {
			const { player, localTransform3D: transform } = entity.components;
			// A simulation countdown freezes on pause and never catches up missed shots.
			const previousCooldown = player.lastShotTime;
			player.lastShotTime = Math.max(0, previousCooldown - dt);
			const requested = input.shotRequested || input.mouseButtons.left;
			input.shotRequested = false;
			if (!requested || player.lastShotTime > 0) return previousCooldown > 0 ? undefined : false;
			player.lastShotTime = 1 / player.fireRate;
			const direction = new Vector3(0, 0, -1).applyQuaternion(
				new Quaternion().setFromEuler(new Euler(transform.rx, transform.ry, 0, 'YXZ')),
			);
			const randomAngle = Math.random() * 0.0174;
			const perpendicular = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(direction).normalize();
			direction.add(perpendicular.multiplyScalar(Math.sin(randomAngle))).normalize();
			ecs.eventBus.publish('playerShoot', { direction });
		});
}
