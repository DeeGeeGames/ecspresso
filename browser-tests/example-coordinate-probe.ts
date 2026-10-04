import ECSpresso from 'ecspresso';
import { createRenderer2DPlugin } from 'ecspresso/plugins/rendering/renderer2D';
import { createCameraPlugin } from 'ecspresso/plugins/spatial/camera';
import { createIsoProjectionPlugin, screenToIsoWorld } from 'ecspresso/plugins/isometric/projection';
import { createPointerTransform } from '../examples/camera/pointer-coordinates';

/** Probe the real initialized Pixi/camera boundary, including DOM offset and CSS scaling. */
export async function runCoordinateProbe() {
	const world = ECSpresso.create()
		.withPlugin(createRenderer2DPlugin({ width: 800, height: 600, startLoop: false, camera: false }))
		.withPlugin(createCameraPlugin({ viewportWidth: 800, viewportHeight: 600, initial: { x: 5, y: 5 } }))
		.withPlugin(createIsoProjectionPlugin({ tileWidth: 64, tileHeight: 32, camera: true }))
		.build();
	await world.initialize();
	const app = world.getResource('pixiApp');
	const camera = world.getResource('cameraState');
	app.canvas.style.cssText = 'position:fixed;left:120px;top:80px;width:400px;height:300px';
	const transform = createPointerTransform(() => app, true);
	function pointer(clientX: number, clientY: number) {
		const normalized = transform(clientX, clientY);
		return screenToIsoWorld(normalized.x, normalized.y, camera, world.getResource('isoProjection'), app.canvas);
	}
	const center = pointer(320, 230);
	camera.zoom = 2;
	const zoomed = pointer(352, 246);
	app.canvas.style.width = '1600px';
	app.canvas.style.height = '1200px';
	const resizedCenter = pointer(920, 680);
	await world.dispose();
	return { center, zoomed, resizedCenter };
}
