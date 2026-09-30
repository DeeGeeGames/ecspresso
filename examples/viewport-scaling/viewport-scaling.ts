import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from 'ecspresso';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
	createSpriteComponents,
	clientToLogical,
	reapplyViewportScale,
	type ScaleMode,
	type ViewportScale,
} from 'ecspresso/plugins/rendering/renderer2D';

const DESIGN_W = 1920;
const DESIGN_H = 1080;

// canvas and viewportScale only exist after ecs.initialize(); the input plugin's
// coordinateTransform closure is not invoked until pointer events fire, so lazy binding is safe.
const inputBinding: { canvas: HTMLCanvasElement | null; viewport: ViewportScale | null } = {
	canvas: null,
	viewport: null,
};

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1a1a2e',
		screenScale: { width: DESIGN_W, height: DESIGN_H, mode: 'fit' },
	}))
	.withPlugin(createInputPlugin({
		coordinateTransform: (clientX, clientY) => {
			const { canvas, viewport } = inputBinding;
			if (!canvas || !viewport) return { x: clientX, y: clientY };
			return clientToLogical(clientX, clientY, canvas, viewport);
		},
	}))
	.withComponentTypes<{
		reticle: true;
		spawnedBall: true;
	}>()
	.build();

ecs.addSystem('reticle-follow')
	.inPhase('update')
	.withResources(['inputState'])
	.setProcessEach({ with: ['reticle', 'localTransform'] }, ({ entity, resources: { inputState }, ecs }) => {
		const { x, y } = inputState.pointer.position;
		const { localTransform } = entity.components;
		if (localTransform.x === x && localTransform.y === y) return;
		localTransform.x = x;
		localTransform.y = y;
		ecs.markChanged(entity.id, 'localTransform');
	});

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const canvas = pixiApp.canvas;
const viewport = ecs.getResource('viewportScale');
Object.assign(inputBinding, { canvas, viewport });

const gridGraphics = new Graphics();
for (let x = 0; x <= DESIGN_W; x += 120) {
	gridGraphics.moveTo(x, 0).lineTo(x, DESIGN_H);
}
for (let y = 0; y <= DESIGN_H; y += 120) {
	gridGraphics.moveTo(0, y).lineTo(DESIGN_W, y);
}
gridGraphics.stroke({ width: 1, color: 0x2a3a5e });
ecs.spawn(createGraphicsComponents(gridGraphics, { x: 0, y: 0 }));

const borderGraphics = new Graphics()
	.rect(0, 0, DESIGN_W, DESIGN_H)
	.stroke({ width: 4, color: 0x4ecdc4 });
ecs.spawn(createGraphicsComponents(borderGraphics, { x: 0, y: 0 }));

const CORNERS: ReadonlyArray<{ x: number; y: number; color: number }> = [
	{ x: 0, y: 0, color: 0xff6b6b },
	{ x: DESIGN_W, y: 0, color: 0xf9ca24 },
	{ x: 0, y: DESIGN_H, color: 0x4ecdc4 },
	{ x: DESIGN_W, y: DESIGN_H, color: 0xa29bfe },
];

for (const corner of CORNERS) {
	const g = new Graphics()
		.rect(-20, -20, 40, 40)
		.fill(corner.color);
	ecs.spawn(createGraphicsComponents(g, { x: corner.x, y: corner.y }));
}

const centerGraphics = new Graphics()
	.circle(0, 0, 8)
	.fill(0xffffff);
ecs.spawn(createGraphicsComponents(centerGraphics, { x: DESIGN_W / 2, y: DESIGN_H / 2 }));

const reticleGraphics = new Graphics()
	.moveTo(-16, 0).lineTo(16, 0)
	.moveTo(0, -16).lineTo(0, 16)
	.stroke({ width: 2, color: 0xffffff })
	.circle(0, 0, 10)
	.stroke({ width: 2, color: 0xffffff });
ecs.spawn({
	...createGraphicsComponents(reticleGraphics, { x: DESIGN_W / 2, y: DESIGN_H / 2 }),
	reticle: true,
});

const BALL_COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa29bfe, 0xfd79a8];

function spawnBallAt(logicalX: number, logicalY: number) {
	const color = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)] ?? 0xffffff;
	const sprite = new Sprite(
		pixiApp.renderer.generateTexture(
			new Graphics().circle(0, 0, 14).fill(color),
		),
	);
	ecs.spawn({
		...createSpriteComponents(sprite, { x: logicalX, y: logicalY }, { anchor: { x: 0.5, y: 0.5 } }),
		spawnedBall: true,
	});
}

// Listen directly on the canvas so DOM button clicks (which sit above it in the stacking order) don't trigger spawns.
canvas.addEventListener('pointerdown', (e: PointerEvent) => {
	const { x, y } = clientToLogical(e.clientX, e.clientY, canvas, viewport);
	spawnBallAt(x, y);
});

const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;top:12px;left:12px;z-index:999999;padding:10px 14px;font:13px/1.6 monospace;background:rgba(20,20,40,0.85);color:#e0e0e0;border:1px solid #444;border-radius:4px;pointer-events:none;white-space:pre';
document.body.appendChild(hud);

ecs.addSystem('hud-update')
	.inPhase('render')
	.withResources(['inputState'])
	.setProcess(({ resources: { inputState } }) => {
		const logical = inputState.pointer.position;
		hud.textContent =
			`design:    ${DESIGN_W} x ${DESIGN_H}\n` +
			`window:    ${window.innerWidth} x ${window.innerHeight}\n` +
			`physical:  ${Math.round(viewport.physicalWidth)} x ${Math.round(viewport.physicalHeight)}\n` +
			`mode:      ${viewport.mode}\n` +
			`scale:     ${viewport.scaleX.toFixed(3)} x ${viewport.scaleY.toFixed(3)}\n` +
			`offset:    ${Math.round(viewport.offsetX)}, ${Math.round(viewport.offsetY)}\n` +
			`\n` +
			`logical:   ${Math.round(logical.x)}, ${Math.round(logical.y)}`;
	});

const NEXT_MODE: Record<ScaleMode, ScaleMode> = {
	fit: 'cover',
	cover: 'stretch',
	stretch: 'fit',
};

const modeBtn = document.createElement('button');
modeBtn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999;padding:8px 16px;font:13px/1 monospace;background:#2a2a3e;color:#4ecdc4;border:1px solid #4ecdc4;border-radius:4px;cursor:pointer';
modeBtn.textContent = 'Mode: fit';

modeBtn.addEventListener('click', () => {
	const nextMode = NEXT_MODE[viewport.mode];
	viewport.mode = nextMode;
	reapplyViewportScale(pixiApp);
	modeBtn.textContent = `Mode: ${nextMode}`;
});

document.body.appendChild(modeBtn);

const clearBtn = document.createElement('button');
clearBtn.style.cssText = 'position:fixed;bottom:12px;right:130px;z-index:999999;padding:8px 16px;font:13px/1 monospace;background:#2a2a3e;color:#ff6b6b;border:1px solid #ff6b6b;border-radius:4px;cursor:pointer';
clearBtn.textContent = 'Clear';

clearBtn.addEventListener('click', () => {
	const balls = ecs.getEntitiesWithQuery(['spawnedBall']);
	for (const entity of balls) {
		ecs.removeEntity(entity.id);
	}
});

document.body.appendChild(clearBtn);
