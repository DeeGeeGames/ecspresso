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

class StressScene extends Phaser.Scene {
	state: SceneState | null = null;
	worldPoint = new Phaser.Math.Vector2();
	initialCount = 50;

	constructor() {
		super('stress');
	}

	getState(): SceneState {
		if (!this.state) throw new Error('StressScene not initialized');
		return this.state;
	}

	preload() {
		COLORS.forEach((color, i) => {
			const g = this.make.graphics({ x: 0, y: 0 }, false);
			g.fillStyle(color, 1);
			g.fillCircle(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS);
			g.generateTexture(`ball-${i}`, BALL_RADIUS * 2, BALL_RADIUS * 2);
			g.destroy();
		});
	}

	create() {
		this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

		const cam = this.cameras.main;
		cam.setBounds(0, 0, WORLD_W, WORLD_H);
		cam.setZoom(1);
		cam.centerOn(SCREEN_W, SCREEN_H);

		const balls = this.physics.add.group({
			classType: Phaser.Physics.Arcade.Image,
			runChildUpdate: false,
		});
		const collider = this.physics.add.collider(balls, balls);

		const kb = this.input.keyboard;
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

		const state: SceneState = {
			balls,
			collider,
			keys,
			pointer: null,
			pointerDown: false,
		};
		this.state = state;

		this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
			state.pointerDown = true;
			state.pointer = p;
		});
		this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
			state.pointer = p;
		});
		this.input.on('pointerup', () => { state.pointerDown = false; });
		this.input.on('pointerupoutside', () => { state.pointerDown = false; });

		this.input.on('wheel', (
			_p: Phaser.Input.Pointer,
			_over: unknown,
			_dx: number,
			dy: number,
		) => {
			const next = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -0.1 : 0.1), 0.5, 2);
			cam.setZoom(next);
		});

		for (let i = 0; i < this.initialCount; i++) {
			this.spawnBall(
				BALL_RADIUS + Math.random() * (WORLD_W - BALL_RADIUS * 2),
				BALL_RADIUS + Math.random() * (WORLD_H - BALL_RADIUS * 2),
			);
		}
	}

	spawnBall(x: number, y: number) {
		const state = this.getState();
		const idx = Math.floor(Math.random() * COLORS.length);
		const ball = state.balls.create(x, y, `ball-${idx}`) as Phaser.Physics.Arcade.Image;
		const body = ball.body as Phaser.Physics.Arcade.Body;
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

	update() {
		if (!this.state) return;
		const { keys, pointer, pointerDown } = this.state;
		const cam = this.cameras.main;
		const speed = 5 / cam.zoom;
		if (keys.W.isDown || keys.UP.isDown) cam.scrollY -= speed;
		if (keys.S.isDown || keys.DOWN.isDown) cam.scrollY += speed;
		if (keys.A.isDown || keys.LEFT.isDown) cam.scrollX -= speed;
		if (keys.D.isDown || keys.RIGHT.isDown) cam.scrollX += speed;

		if (pointerDown && pointer) {
			const wp = cam.getWorldPoint(pointer.x, pointer.y, this.worldPoint);
			for (let i = 0; i < SPAWN_RATE; i++) {
				this.spawnBall(
					wp.x + (Math.random() - 0.5) * 40,
					wp.y + (Math.random() - 0.5) * 40,
				);
			}
		}
	}

	setCollisionEnabled(enabled: boolean) {
		this.getState().collider.active = enabled;
	}

	ballCount(): number {
		return this.state ? this.state.balls.getLength() : 0;
	}

	removeBalls(count: number) {
		if (!this.state) return;
		const balls = this.state.balls;
		balls.getChildren().slice(-count).forEach(b => balls.remove(b, true, true));
	}
}

export type StartOptions = {
	initialCount: number;
	onCountChange: (count: number) => void;
};

export function startPhaser(options: StartOptions): () => void {
	const scene = new StressScene();
	scene.initialCount = options.initialCount;
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
		scene,
		banner: false,
	});

	const getScene = (): StressScene | null => {
		const s = game.scene.getScene('stress');
		return s instanceof StressScene ? s : null;
	};

	const cleanupToggle = createCollisionToggle((enabled) => {
		getScene()?.setCollisionEnabled(enabled);
	});

	const cleanupCountInput = createEntityCountInput({
		getCount: () => getScene()?.ballCount() ?? 0,
		spawnAt: (x, y) => { getScene()?.spawnBall(x, y); },
		removeMany: (count) => { getScene()?.removeBalls(count); },
		onChange: options.onCountChange,
	});

	const overlay = document.createElement('div');
	overlay.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999;padding:6px 10px;font:12px/1.4 monospace;background:rgba(0,0,0,0.6);color:#0f0;border:1px solid #333;border-radius:4px;pointer-events:none;min-width:140px;white-space:pre';
	document.body.appendChild(overlay);

	let lastTime = performance.now();
	let frames = 0;
	let rafId = 0;
	const rafLoop = () => {
		frames++;
		const now = performance.now();
		if (now - lastTime >= 500) {
			const fps = Math.round((frames * 1000) / (now - lastTime));
			frames = 0;
			lastTime = now;
			const scene = getScene();
			const count = scene ? scene.ballCount() : 0;
			overlay.textContent = `Phaser ${Phaser.VERSION}\nFPS: ${fps}\nBalls: ${count}`;
		}
		rafId = requestAnimationFrame(rafLoop);
	};
	rafId = requestAnimationFrame(rafLoop);

	return function destroy() {
		cancelAnimationFrame(rafId);
		overlay.remove();
		cleanupCountInput();
		cleanupToggle();
		game.destroy(true);
	};
}
