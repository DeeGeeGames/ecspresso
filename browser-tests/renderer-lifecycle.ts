import ECSpresso from '../src/index';
import { Application, CanvasSource, Sprite, Texture } from 'pixi.js';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createRenderer2DPlugin, createSpriteComponents } from '../src/plugins/rendering/renderer2D';
import { createRenderer3DPlugin, createMeshComponents } from '../src/plugins/rendering/renderer3D';

const requestFrame = window.requestAnimationFrame.bind(window);
const cancelFrame = window.cancelAnimationFrame.bind(window);
const pendingFrames = new Set<number>();
window.requestAnimationFrame = function request(callback) {
	const id = requestFrame(function frame(time) {
		pendingFrames.delete(id);
		callback(time);
	});
	pendingFrames.add(id);
	return id;
};
window.cancelAnimationFrame = function cancel(id) {
	pendingFrames.delete(id);
	cancelFrame(id);
};

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

async function pixiOwnership(managed: boolean): Promise<void> {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const supplied = new Application();
	if (!managed) {
		await supplied.init({ width: 64, height: 64 });
		container.appendChild(supplied.canvas);
	}
	const plugin = managed
		? createRenderer2DPlugin({ container, width: 64, height: 64, startLoop: false })
		: createRenderer2DPlugin({ app: supplied, startLoop: true });
	const world = ECSpresso.create().withPlugin(plugin).build();
	await world.initialize();
	const app = world.getResource('pixiApp');
	const canvas = app.canvas;
	const baselineTickerCount = managed ? 0 : supplied.ticker.count - 1;
	const textureCanvas = document.createElement('canvas');
	textureCanvas.width = 4;
	textureCanvas.height = 4;
	const texture = new Texture({ source: new CanvasSource({ resource: textureCanvas }) });
	const sprite = new Sprite(texture);
	world.spawn(createSpriteComponents(sprite, { x: 0, y: 0 }));
	world.update(0);
	assert(sprite.parent !== null, 'Pixi sprite was not attached');
	await world.dispose();
	assert(!sprite.destroyed && !texture.destroyed, 'World destroyed caller-owned Pixi objects');
	assert(sprite.parent === null, 'World left a Pixi sprite attached');
	assert(canvas.isConnected === !managed, 'Incorrect Pixi canvas ownership');
	if (!managed) {
		assert(supplied.stage !== null, 'World destroyed supplied Pixi application');
		assert(supplied.ticker.count === baselineTickerCount, 'World retained its Pixi ticker callback');
		supplied.destroy({ removeView: true }, { children: false });
	}
	sprite.destroy();
	texture.destroy(true);
	container.remove();
}

async function threeOwnership(managed: boolean): Promise<void> {
	const baselineFrames = pendingFrames.size;
	const container = document.createElement('div');
	document.body.appendChild(container);
	const supplied = managed ? undefined : new WebGLRenderer();
	if (supplied) container.appendChild(supplied.domElement);
	const world = ECSpresso.create().withPlugin(supplied
		? createRenderer3DPlugin({ renderer: supplied, scene: new Scene(), camera: new PerspectiveCamera() })
		: createRenderer3DPlugin({ container, width: 64, height: 64 })).build();
	await world.initialize();
	const renderer = world.getResource('threeRenderer');
	const originalDispose = renderer.dispose.bind(renderer);
	const calls = { renderer: 0, geometry: 0, material: 0 };
	renderer.dispose = function dispose() { calls.renderer++; originalDispose(); };
	const geometry = new BoxGeometry();
	const material = new MeshBasicMaterial();
	geometry.addEventListener('dispose', () => { calls.geometry++; });
	material.addEventListener('dispose', () => { calls.material++; });
	const mesh = new Mesh(geometry, material);
	world.spawn(createMeshComponents(mesh, { x: 0, y: 0, z: -5 }));
	world.update(0);
	assert(mesh.parent !== null, 'Three mesh was not attached');
	await world.dispose();
	assert(calls.renderer === Number(managed), 'Incorrect Three renderer ownership');
	assert(calls.geometry === 0 && calls.material === 0, 'World destroyed caller-owned Three assets');
	assert(mesh.parent === null, 'World left a Three mesh attached');
	assert(renderer.domElement.isConnected === !managed, 'Incorrect Three canvas ownership');
	assert(pendingFrames.size === baselineFrames, 'World retained its Three animation frame');
	if (!managed) renderer.dispose();
	geometry.dispose();
	material.dispose();
	container.remove();
}

async function pixiInstallationIsolation(): Promise<void> {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const plugin = createRenderer2DPlugin({ container, width: 64, height: 64, startLoop: false, renderLayers: ['actors'] });
	const a = ECSpresso.create().withPlugin(plugin).build();
	const b = ECSpresso.create().withPlugin(plugin).build();
	await a.initialize();
	await b.initialize();
	const spriteA = new Sprite();
	const spriteB = new Sprite();
	a.spawn({ ...createSpriteComponents(spriteA), renderLayer: 'actors' });
	b.spawn({ ...createSpriteComponents(spriteB), renderLayer: 'actors' });
	a.update(0);
	b.update(0);
	assert(spriteA.parent?.parent === a.getResource('rootContainer'), 'World A lost its Pixi layer');
	assert(spriteB.parent?.parent === b.getResource('rootContainer'), 'World B reused world A Pixi layer');
	await a.dispose();
	b.update(0);
	assert(spriteB.parent?.parent === b.getResource('rootContainer'), 'World A disposal removed world B Pixi layer');
	await b.dispose();
	assert(spriteB.parent === null, 'World B retained its Pixi sprite after disposal');
	spriteA.destroy();
	spriteB.destroy();
	container.remove();
}

async function threeInstallationIsolation(): Promise<void> {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const plugin = createRenderer3DPlugin({ container, width: 64, height: 64, startLoop: false });
	const a = ECSpresso.create().withPlugin(plugin).build();
	const b = ECSpresso.create().withPlugin(plugin).build();
	await a.initialize();
	await b.initialize();
	const geometry = new BoxGeometry();
	const material = new MeshBasicMaterial();
	const meshA = new Mesh(geometry, material);
	const meshB = new Mesh(geometry, material);
	a.spawn(createMeshComponents(meshA, { x: 1, y: 0, z: -5 }));
	b.spawn(createMeshComponents(meshB, { x: 2, y: 0, z: -5 }));
	a.update(0);
	b.update(0);
	assert(meshA.parent === a.getResource('scene'), 'World A lost its Three mesh');
	assert(meshB.parent === b.getResource('scene'), 'World B reused world A Three scene');
	await a.dispose();
	b.update(0);
	assert(meshB.parent === b.getResource('scene'), 'World A disposal removed world B Three mesh');
	await b.dispose();
	assert(meshB.parent === null, 'World B retained its Three mesh after disposal');
	geometry.dispose();
	material.dispose();
	container.remove();
}

try {
	await pixiOwnership(true);
	await pixiOwnership(false);
	await threeOwnership(true);
	await threeOwnership(false);
	await pixiInstallationIsolation();
	await threeInstallationIsolation();
	document.body.dataset['status'] = 'passed';
	document.body.textContent = 'PASS: Pixi/Three renderer ownership and installation isolation';
} catch (error) {
	document.body.dataset['status'] = 'failed';
	document.body.textContent = String(error);
	throw error;
} finally {
	window.requestAnimationFrame = requestFrame;
	window.cancelAnimationFrame = cancelFrame;
}
