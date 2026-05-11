import { Graphics, Text, TextStyle, Container, Sprite } from 'pixi.js';
import ECSpresso from "../../src";
import {
	createRenderer2DPlugin,
	createSpriteComponents,
} from "../../src/plugins/rendering/renderer2D";
import { createTimerPlugin, createTimer } from "../../src/plugins/scripting/timers";

// -- Constants --

const SCREEN_W = 800;
const SCREEN_H = 500;
const GAME_DURATION = 20;
const DOT_COLORS = [0x4fc3f7, 0xf06292, 0xba68c8, 0x81c784, 0xffb74d, 0xe57373] as const;

const nextSpawnInterval = () => 0.4 + Math.random() * 0.7;

// -- ECS setup with screen definitions --

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1a1a2e',
		width: SCREEN_W,
		height: SCREEN_H,
	}))
	.withPlugin(createTimerPlugin())
	.withComponentTypes<{
		dot: { speed: number };
		clock: true;
	}>()
	.withScreens(screens => screens
		.add('menu', {
			initialState: () => ({}),
		})
		.add('playing', {
			initialState: () => ({ score: 0 }),
		})
		.add('paused', {
			initialState: () => ({}),
		})
		.add('gameOver', {
			initialState: (config: { finalScore: number }) => ({
				finalScore: config.finalScore,
			}),
		})
	)
	.build();

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');

// -- UI helpers --

function createLabel(label: string, size: number, color: string): Text {
	const text = new Text({
		text: label,
		style: new TextStyle({
			fontFamily: 'monospace',
			fontSize: size,
			fill: color,
			align: 'center',
		}),
	});
	text.anchor.set(0.5);
	return text;
}

function centeredAt(text: Text, x: number, y: number): Text {
	text.position.set(x, y);
	return text;
}

// -- Screen UI containers --

// Menu
const menuContainer = new Container();
menuContainer.addChild(
	centeredAt(createLabel('Dot Catcher', 44, '#ffffff'), SCREEN_W / 2, SCREEN_H / 2 - 40),
	centeredAt(createLabel('Press SPACE to start', 18, '#888888'), SCREEN_W / 2, SCREEN_H / 2 + 30),
);

// Playing HUD
const hudContainer = new Container();
const scoreText = createLabel('Score: 0', 20, '#ffffff');
scoreText.anchor.set(0, 0);
scoreText.position.set(12, 10);
const timerText = createLabel('20', 20, '#ffffff');
timerText.anchor.set(1, 0);
timerText.position.set(SCREEN_W - 12, 10);
hudContainer.addChild(scoreText, timerText);

// Pause overlay
const pauseContainer = new Container();
pauseContainer.addChild(
	new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: 0.6 }),
	centeredAt(createLabel('PAUSED', 44, '#ffffff'), SCREEN_W / 2, SCREEN_H / 2 - 20),
	centeredAt(createLabel('Press P to resume', 18, '#888888'), SCREEN_W / 2, SCREEN_H / 2 + 30),
);

// Game Over
const gameOverContainer = new Container();
const finalScoreText = centeredAt(createLabel('Score: 0', 28, '#ffffff'), SCREEN_W / 2, SCREEN_H / 2);
gameOverContainer.addChild(
	centeredAt(createLabel('Time\'s Up!', 44, '#ff6666'), SCREEN_W / 2, SCREEN_H / 2 - 60),
	finalScoreText,
	centeredAt(createLabel('Press SPACE to play again', 18, '#888888'), SCREEN_W / 2, SCREEN_H / 2 + 50),
);

// Add all to stage (hidden by default)
[menuContainer, hudContainer, pauseContainer, gameOverContainer].forEach(c => {
	c.visible = false;
	pixiApp.stage.addChild(c);
});

// -- Dot spawning --

function spawnDot() {
	const radius = 14 + Math.random() * 14;
	const color = DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)]!;
	const x = radius + Math.random() * (SCREEN_W - radius * 2);
	const speed = 60 + Math.random() * 120;
	const lifetime = (SCREEN_H + radius * 2) / speed;

	const gfx = new Graphics().circle(0, 0, radius).fill(color);
	const sprite = new Sprite(pixiApp.renderer.generateTexture(gfx));
	sprite.anchor.set(0.5);
	sprite.eventMode = 'static';
	sprite.cursor = 'pointer';

	const entity = ecs.spawn({
		...createSpriteComponents(sprite, { x, y: -radius }, { anchor: { x: 0.5, y: 0.5 } }),
		dot: { speed },
		timers: {
			life: createTimer(lifetime, {
				onComplete: ({ entityId }) => ecs.removeEntity(entityId),
			}),
		},
	});

	sprite.on('pointerdown', () => {
		if (!ecs.isCurrentScreen('playing')) return;
		ecs.getScreenState('playing').score += 1;
		ecs.removeEntity(entity.id);
	});
}

// -- Screen lifecycle: spawn the playing-screen clock entity --

ecs.onScreenEnter('playing', ({ ecs }) => {
	ecs.spawn({
		clock: true,
		timers: {
			gameOver: createTimer(GAME_DURATION, {
				onComplete: () => {
					const state = ecs.getScreenState('playing');
					void ecs.setScreen('gameOver', { finalScore: state.score });
				},
			}),
			dotSpawn: createTimer(nextSpawnInterval()),
		},
	}, { scope: 'playing' });
});

// -- Pause: freeze all timers while the paused overlay is on top --
// The timer plugin's tick system runs globally, so screen-gating doesn't pause it.

const setAllTimersActive = (predicate: (t: { elapsed: number; duration: number }) => boolean) => {
	for (const entity of ecs.getEntitiesWithQuery(['timers']))
		for (const slot in entity.components.timers) {
			const t = entity.components.timers[slot];
			if (t) t.active = predicate(t);
		}
};

ecs.onScreenEnter('paused', () => setAllTimersActive(() => false));
ecs.onScreenExit('paused', () => setAllTimersActive(t => t.elapsed < t.duration));

// -- Systems --

// Screen UI visibility — runs every frame regardless of current screen
ecs.addSystem('screenUI')
	.inPhase('render')
	.addQuery('clock', { with: ['clock', 'timers'] })
	.setProcess(({ ecs, queries }) => {
		menuContainer.visible = ecs.isCurrentScreen('menu');
		hudContainer.visible = ecs.isScreenActive('playing');
		pauseContainer.visible = ecs.isCurrentScreen('paused');
		gameOverContainer.visible = ecs.isCurrentScreen('gameOver');

		const playingState = ecs.tryGetScreenState('playing');
		const clock = queries.clock[0];
		if (playingState && clock) {
			const game = clock.components.timers['gameOver'];
			const remaining = game ? Math.max(0, game.duration - game.elapsed) : 0;
			scoreText.text = `Score: ${playingState.score}`;
			timerText.text = `${Math.ceil(remaining)}`;
		}

		const gameOverState = ecs.tryGetScreenState('gameOver');
		if (gameOverState) {
			finalScoreText.text = `Final Score: ${gameOverState.finalScore}`;
		}
	});

// Dot spawner — re-arms its slot each cycle with a fresh random duration
ecs.addSystem('dotSpawner')
	.inScreens(['playing'])
	.addQuery('clock', { with: ['clock', 'timers'] })
	.setProcess(({ queries }) => {
		const clock = queries.clock[0];
		if (!clock) return;
		const slot = clock.components.timers['dotSpawn'];
		if (!slot?.justFinished) return;
		spawnDot();
		slot.elapsed = 0;
		slot.duration = nextSpawnInterval();
		slot.active = true;
	});

// Dot movement — lifetime expiry is handled by the timer plugin's onComplete
ecs.addSystem('dotMovement')
	.inScreens(['playing'])
	.setProcessEach({ with: ['dot', 'localTransform'] }, ({ entity, dt, ecs }) => {
		ecs.mutateComponent(entity.id, 'localTransform', (lt) => {
			lt.y += entity.components.dot.speed * dt;
		});
	});

// -- Keyboard input --

document.addEventListener('keydown', (e) => {
	if (e.code === 'Space') {
		e.preventDefault();
		if (ecs.isCurrentScreen('menu') || ecs.isCurrentScreen('gameOver')) {
			void ecs.setScreen('playing', {});
		}
	}

	if (e.code === 'KeyP' || e.code === 'Escape') {
		e.preventDefault();
		if (ecs.isCurrentScreen('playing')) {
			void ecs.pushScreen('paused', {});
		} else if (ecs.isCurrentScreen('paused')) {
			void ecs.popScreen();
		}
	}
});

// -- Start on the menu screen --

await ecs.setScreen('menu', {});
