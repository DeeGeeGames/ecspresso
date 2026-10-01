import { createBeanGraphics, examplePalette } from '../brand';
import { Sprite, Text, TextStyle } from 'pixi.js';
import ECSpresso from "ecspresso";
import {
	createRenderer2DPlugin,
	createSpriteComponents,
} from "ecspresso/plugins/rendering/renderer2D";
import {
	linear,
	easeInQuad,
	easeOutQuad,
	easeInOutCubic,
	easeOutBounce,
	easeInOutElastic,
	easeOutBack,
	createTweenPlugin,
	createTween,
	createTweenSequence,
	type LoopMode,
} from 'ecspresso/plugins/scripting/tween';

// -- Layout constants --

const SCREEN_W = 900;
const SCREEN_H = 600;
const ROW_H = 70;
const LEFT_X = 180;
const RIGHT_X = SCREEN_W - 60;
const BALL_RADIUS = 14;

// -- ECS setup --

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({
		background: examplePalette.background,
		width: SCREEN_W,
		height: SCREEN_H,
	}))
	.withPlugin(createTweenPlugin())
	.build();

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');

// -- Loop mode dropdown --

const dropdown = document.createElement('select');
dropdown.style.cssText = 'position:absolute;top:10px;right:10px;z-index:10;padding:4px 8px;font-family:monospace;font-size:13px;background:#2a2a3e;color:#ccc;border:1px solid #555;border-radius:4px;cursor:pointer;';

const loopModes: readonly LoopMode[] = ['once', 'loop', 'yoyo'];
loopModes.forEach((mode) => {
	const opt = document.createElement('option');
	opt.value = mode;
	opt.textContent = `Loop: ${mode}`;
	opt.selected = mode === 'yoyo';
	dropdown.appendChild(opt);
});

document.body.appendChild(dropdown);

// -- Demo definitions --
// Each row shows a ball animating from left to right with a different easing.

interface Demo {
	label: string;
	color: number;
	makeTween: (loop: LoopMode) => ReturnType<typeof createTween>;
}

const demos: Demo[] = [
	{
		label: 'Linear',
		color: 0x9d683d,
		makeTween: (loop) => createTween('localTransform', 'x', RIGHT_X, 2, {
			from: LEFT_X, loop, loops: -1,
		}),
	},
	{
		label: 'Ease In (Quad)',
		color: 0xb85b3d,
		makeTween: (loop) => createTween('localTransform', 'x', RIGHT_X, 2, {
			from: LEFT_X, easing: easeInQuad, loop, loops: -1,
		}),
	},
	{
		label: 'Ease Out (Quad)',
		color: 0x6b4a33,
		makeTween: (loop) => createTween('localTransform', 'x', RIGHT_X, 2, {
			from: LEFT_X, easing: easeOutQuad, loop, loops: -1,
		}),
	},
	{
		label: 'Ease In/Out (Cubic)',
		color: 0xc8956a,
		makeTween: (loop) => createTween('localTransform', 'x', RIGHT_X, 2, {
			from: LEFT_X, easing: easeInOutCubic, loop, loops: -1,
		}),
	},
	{
		label: 'Bounce Out',
		color: 0x8c674c,
		makeTween: (loop) => createTween('localTransform', 'x', RIGHT_X, 2, {
			from: LEFT_X, easing: easeOutBounce, loop, loops: -1,
		}),
	},
	{
		label: 'Back Out',
		color: 0x3c2516,
		makeTween: (loop) => createTween('localTransform', 'x', RIGHT_X, 1.2, {
			from: LEFT_X, easing: easeOutBack, loop, loops: -1,
		}),
	},
	{
		label: 'Sequence',
		color: 0x9d683d,
		makeTween: (loop) => createTweenSequence([
			{
				targets: [{ component: 'localTransform', field: 'x', to: RIGHT_X }],
				duration: 1,
				easing: easeInOutElastic,
			},
			{
				targets: [{ component: 'localTransform', field: 'x', to: LEFT_X, from: RIGHT_X }],
				duration: 1,
				easing: linear,
			},
		], { loop, loops: -1 }),
	},
];

// -- Spawn demo rows --

const labelStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 13,
	fill: '#6b4a33',
});

function createBallSprite(color: number): Sprite {
	const gfx = createBeanGraphics(BALL_RADIUS, color);
	return new Sprite(pixiApp.renderer.generateTexture(gfx));
}

function readLoopMode(): LoopMode {
	const value = dropdown.value;
	if (value !== 'once' && value !== 'loop' && value !== 'yoyo') throw new Error(`Unknown loop mode: ${value}`);
	return value;
}

const defaultLoop = readLoopMode();

const ballEntityIds = demos.map((demo, i) => {
	const y = 50 + i * ROW_H;

	// Label
	const text = new Text({ text: demo.label, style: labelStyle });
	const labelSprite = new Sprite(pixiApp.renderer.generateTexture(text));
	ecs.spawn({
		...createSpriteComponents(labelSprite, { x: 12, y: y - 10 }),
	});

	// Animated ball
	const entity = ecs.spawn({
		...createSpriteComponents(createBallSprite(demo.color), { x: LEFT_X, y }, {
			anchor: { x: 0.5, y: 0.5 },
		}),
		...demo.makeTween(defaultLoop),
	});

	return entity.id;
});

// -- Dropdown change handler --

dropdown.addEventListener('change', () => {
	const loop = readLoopMode();
	ballEntityIds.forEach((id, i) => {
		const demo = demos[i];
		if (!demo) return;
		const tweenData = demo.makeTween(loop);
		ecs.addComponent(id, 'tween', tweenData.tween);
	});
});
