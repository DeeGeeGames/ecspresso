import Phaser from 'phaser';

import {
	SCREEN_W,
	SCREEN_H,
	WORLD_W,
	WORLD_H,
	BALL_RADIUS,
	SPAWN_RATE,
	COLORS,
	createCollisionToggle,
	createEntityCountInput,
	createFpsOverlay,
} from './shared';

type SceneState = {
	balls: Phaser.Physics.Arcade.Group;
	collider: Phaser.Physics.Arcade.Collider;
	keys: {
		W: Phaser.Input.Keyboard.Key;
		A: Phaser.Input.Keyboard.Key;
		S: Phaser.Input.Keyboard.Key;
		D: Phaser.Input.Keyboard.Key;
		UP: Phaser.Input.Keyboard.Key;
		DOWN: Phaser.Input.Keyboard.Key;
		LEFT: Phaser.Input.Keyboard.Key;
		RIGHT: Phaser.Input.Keyboard.Key;
	};
	pointer: Phaser.Input.Pointer | null;
	pointerDown: boolean;
};

function createStressScene(initialCount: number) {
	const state: { value: SceneState | null } = { value: null };
	const worldPoint = new Phaser.Math.Vector2();
	const scene = new Phaser.Scene('stress');
	Object.assign(scene, { preload, create, update });

	function getState(): SceneState {
		if (!state.value) throw new Error('StressScene not initialized');
		return state.value;
	}

	function preload() {
		COLORS.forEach((color, i) => {
			const g = scene.make.graphics({ x: 0, y: 0 }, false);
			g.fillStyle(color, 1);
			g.fillCircle(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS);
			g.generateTexture(`ball-${i}`, BALL_RADIUS * 2, BALL_RADIUS * 2);
			g.destroy();
		});
	}

	function create() {
		scene.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

		const cam = scene.cameras.main;
		cam.setBounds(0, 0, WORLD_W, WORLD_H);
		cam.setZoom(1);
		cam.centerOn(SCREEN_W, SCREEN_H);

		const balls = scene.physics.add.group({
			classType: Phaser.Physics.Arcade.Image,
			runChildUpdate: false,
		});
		const collider = scene.physics.add.collider(balls, balls);

		const kb = scene.input.keyboard;
		if (!kb) throw new Error('Keyboard input not available');
		const KC = Phaser.Input.Keyboard.KeyCodes;
		const keys = {
			W: kb.addKey(KC.W),
			A: kb.addKey(KC.A),
			S: kb.addKey(KC.S),
			D: kb.addKey(KC.D),
			UP: kb.addKey(KC.UP),
			DOWN: kb.addKey(KC.DOWN),
			LEFT: kb.addKey(KC.LEFT),
			RIGHT: kb.addKey(KC.RIGHT),
		};

		const createdState: SceneState = {
			balls,
			collider,
			keys,
			pointer: null,
			pointerDown: false,
		};
		state.value = createdState;

		scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
			createdState.pointerDown = true;
			createdState.pointer = p;
		});
		scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
			createdState.pointer = p;
		});
		scene.input.on('pointerup', () => { createdState.pointerDown = false; });
		scene.input.on('pointerupoutside', () => { createdState.pointerDown = false; });

		scene.input.on('wheel', (
			_p: Phaser.Input.Pointer,
			_over: unknown,
			_dx: number,
			dy: number,
		) => {
			const next = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -0.1 : 0.1), 0.5, 2);
			cam.setZoom(next);
		});

		for (let i = 0; i < initialCount; i++) {
			spawnBall(
				BALL_RADIUS + Math.random() * (WORLD_W - BALL_RADIUS * 2),
				BALL_RADIUS + Math.random() * (WORLD_H - BALL_RADIUS * 2),
			);
		}
	}

	function spawnBall(x: number, y: number) {
		const current = getState();
		const idx = Math.floor(Math.random() * COLORS.length);
		const ball: unknown = current.balls.create(x, y, `ball-${idx}`);
		if (!(ball instanceof Phaser.Physics.Arcade.Image)) throw new Error('Expected an arcade image');
		const body = ball.body;
		if (!(body instanceof Phaser.Physics.Arcade.Body)) throw new Error('Expected an arcade body');
		body.setCircle(BALL_RADIUS);
		body.setBounce(1.01, 1.01);
		body.setDamping(true);
		body.setDrag(0.99, 0.99);
		body.setCollideWorldBounds(true);
		body.setVelocity(
			(Math.random() - 0.5) * 400,
			(Math.random() - 0.5) * 200,
		);
	}

	function update() {
		if (!state.value) return;
		const { keys, pointer, pointerDown } = state.value;
		const cam = scene.cameras.main;
		const speed = 5 / cam.zoom;
		if (keys.W.isDown || keys.UP.isDown) cam.scrollY -= speed;
		if (keys.S.isDown || keys.DOWN.isDown) cam.scrollY += speed;
		if (keys.A.isDown || keys.LEFT.isDown) cam.scrollX -= speed;
		if (keys.D.isDown || keys.RIGHT.isDown) cam.scrollX += speed;

		if (pointerDown && pointer) {
			const wp = cam.getWorldPoint(pointer.x, pointer.y, worldPoint);
			for (let i = 0; i < SPAWN_RATE; i++) {
				spawnBall(
					wp.x + (Math.random() - 0.5) * 40,
					wp.y + (Math.random() - 0.5) * 40,
				);
			}
		}
	}

	function setCollisionEnabled(enabled: boolean) {
		getState().collider.active = enabled;
	}

	function ballCount(): number {
		return state.value ? state.value.balls.getLength() : 0;
	}

	function removeBalls(count: number) {
		if (!state.value) return;
		const balls = state.value.balls;
		balls.getChildren().slice(-count).forEach(b => balls.remove(b, true, true));
	}

	return { scene, spawnBall, setCollisionEnabled, ballCount, removeBalls };
}
export type StartOptions = {
	initialCount: number;
	onCountChange: (count: number) => void;
};

export async function startPhaser(options: StartOptions): Promise<() => void> {
	const simulation = createStressScene(options.initialCount);
	const game = new Phaser.Game({
		type: Phaser.AUTO,
		width: SCREEN_W,
		height: SCREEN_H,
		backgroundColor: '#1a1a2e',
		scale: {
			mode: Phaser.Scale.FIT,
			autoCenter: Phaser.Scale.CENTER_BOTH,
		},
		physics: {
			default: 'arcade',
			arcade: { gravity: { x: 0, y: 0 } },
		},
		scene: simulation.scene,
		banner: false,
	});
	await new Promise<void>(resolve => {
		if (game.isRunning) return resolve();
		game.events.once(Phaser.Core.Events.READY, resolve);
	});

	const cleanupToggle = createCollisionToggle((enabled) => {
		simulation.setCollisionEnabled(enabled);
	});

	const cleanupCountInput = createEntityCountInput({
		getCount: () => simulation.ballCount(),
		spawnAt: (x, y) => { simulation.spawnBall(x, y); },
		removeMany: (count) => { simulation.removeBalls(count); },
		onChange: options.onCountChange,
	});

	const cleanupOverlay = createFpsOverlay(
		(fps) => `Phaser ${Phaser.VERSION}\nFPS: ${fps}\nBalls: ${simulation.ballCount()}`,
	);

	return function destroy() {
		cleanupOverlay();
		cleanupCountInput();
		cleanupToggle();
		game.destroy(true);
		// Destruction normally waits for another frame, which a hidden demo may never receive.
		game.step(performance.now(), 0);
	};
}
