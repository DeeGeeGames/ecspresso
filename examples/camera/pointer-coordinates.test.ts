import { expect, test } from 'bun:test';
import { isoToWorld } from 'ecspresso/plugins/isometric/projection';
import { screenToWorld } from 'ecspresso/plugins/spatial/camera';
import ECSpresso from 'ecspresso';
import { createTransformPlugin } from 'ecspresso/plugins/spatial/transform';
import { createCameraPlugin } from 'ecspresso/plugins/spatial/camera';
import { createPointerTransform } from './pointer-coordinates';

async function createCamera() {
	const world = ECSpresso.create().withPlugin(createTransformPlugin())
		.withPlugin(createCameraPlugin({ viewportWidth: 800, viewportHeight: 600, initial: { x: 5, y: 5 } })).build();
	await world.initialize();
	return { world, camera: world.getResource('cameraState') };
}

const iso = { tileWidth: 64, tileHeight: 32, originX: 0, originY: 0 };

test('offset and CSS scale preserve camera center and zoomed pointer positions after resize', async () => {
	const { world, camera } = await createCamera();
	const rect = { left: 120, top: 80, width: 400, height: 300 };
	const surface = { canvas: { getBoundingClientRect: () => rect }, screen: { width: 800, height: 600 } };
	const transform = createPointerTransform(() => surface);
	const center = transform(320, 230);
	expect(screenToWorld(center.x, center.y, camera)).toEqual({ x: 5, y: 5 });
	camera.zoom = 2;
	const pointer = transform(352, 246);
	expect(screenToWorld(pointer.x, pointer.y, camera)).toEqual({ x: 37, y: 21 });
	Object.assign(rect, { width: 1600, height: 1200 });
	const resized = transform(920, 680);
	expect(screenToWorld(resized.x, resized.y, camera)).toEqual({ x: 5, y: 5 });
	await world.dispose();
});

test('iso helper receives centered renderer-pixel offsets without double-subtracting canvas origin', async () => {
	const { world, camera } = await createCamera();
	const rect = { left: 120, top: 80, width: 400, height: 300 };
	const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => rect });
	const transform = createPointerTransform(() => ({ canvas, screen: { width: 800, height: 600 } }), true);
	// Probe the helper's center subtraction plus the published projection inverse.
	const screen = transform(320, 230);
	const camIsoX = (camera.x - camera.y) * iso.tileWidth / 2;
	const camIsoY = (camera.x + camera.y) * iso.tileHeight / 2;
	const offsetX = screen.x - (rect.left + rect.width / 2);
	const offsetY = screen.y - (rect.top + rect.height / 2);
	expect(isoToWorld(camIsoX + offsetX / camera.zoom, camIsoY + offsetY / camera.zoom, iso)).toEqual({ x: 5, y: 5 });
	camera.zoom = 2;
	const pointer = transform(352, 246);
	expect(isoToWorld(camIsoX + (pointer.x - 320) / camera.zoom, camIsoY + (pointer.y - 230) / camera.zoom, iso)).toEqual({ x: 6, y: 5 });
	await world.dispose();
});
