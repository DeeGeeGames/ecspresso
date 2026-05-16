import { serve } from "bun";
import { join } from "path";
import home from './index.html';
import basicMovement from './movement/movement.html';
import playerInput from './player-input/player-input.html';
import events from './events/events.html';
import plugins from './plugins/plugins.html';
import spaceInvaders from './space-invaders/space-invaders.html';
import turretShooter from './turret-shooter/turret-shooter.html';
import hierarchy from './hierarchy/hierarchy.html';
import camera from './camera/camera.html';
import cameraZoom from './camera-zoom/camera-zoom.html';
import stateMachine from './state-machine/state-machine.html';
import tweens from './tweens/tweens.html';
import screens from './screens/screens.html';
import stressTest from './stress-test/stress-test.html';
import stressTest3D from './stress-test-3D/stress-test-3D.html';
import audio from './audio/audio.html';
import coroutines from './coroutines/coroutines.html';
import spriteAnimation from './sprite-animation/sprite-animation.html';
import particles from './particles/particles.html';
import viewportScaling from './viewport-scaling/viewport-scaling.html';
import platformer from './platformer/platformer.html';
import platformer3d from './platformer3d/platformer3d.html';
import rtsMovement from './rts-movement/rts-movement.html';
import turretDefense from './turret-defense/turret-defense.html';
import isometric from './isometric/isometric.html';
import isometricZoom from './isometric-zoom/isometric-zoom.html';
import isometric3d from './isometric-3d/isometric-3d.html';
import reactUI from './react-ui/react-ui.html';
import patrolChase from './patrol-chase/patrol-chase.html';
import flocking from './flocking/flocking.html';
import behaviorTree from './behavior-tree/behavior-tree.html';
import tilemap from './tilemap/tilemap.html';
import ui from './ui/ui.html';
import gamepadTester from './gamepad-tester/gamepad-tester.html';

const examplesDir = import.meta.dir;

const server = serve({
	port: 3000,
	development: {
		hmr: true,
	},
	routes: {
		'/': home,
		'/movement/': basicMovement,
		'/player-input/': playerInput,
		'/events/': events,
		'/plugins/': plugins,
		'/space-invaders/': spaceInvaders,
		'/turret-shooter/': turretShooter,
		'/hierarchy/': hierarchy,
		'/camera/': camera,
		'/camera-zoom/': cameraZoom,
		'/state-machine/': stateMachine,
		'/tweens/': tweens,
		'/screens/': screens,
		'/stress-test/': stressTest,
		'/stress-test-3D/': stressTest3D,
		'/audio/': audio,
		'/coroutines/': coroutines,
		'/sprite-animation/': spriteAnimation,
		'/particles/': particles,
		'/viewport-scaling/': viewportScaling,
		'/platformer/': platformer,
		'/platformer3d/': platformer3d,
		'/rts-movement/': rtsMovement,
		'/turret-defense/': turretDefense,
		'/isometric/': isometric,
		'/isometric-zoom/': isometricZoom,
		'/isometric-3d/': isometric3d,
		'/react-ui/': reactUI,
		'/patrol-chase/': patrolChase,
		'/flocking/': flocking,
		'/behavior-tree/': behaviorTree,
		'/tilemap/': tilemap,
		'/ui/': ui,
		'/gamepad-tester/': gamepadTester,
	},
	async fetch(request) {
		// Serve static assets (e.g. .wav, .mp3) from example directories
		const url = new URL(request.url);
		const filePath = join(examplesDir, url.pathname);
		const file = Bun.file(filePath);

		if (await file.exists()) {
			const headers: Record<string, string> = {};
			if (filePath.endsWith('.wasm')) headers['Content-Type'] = 'application/wasm';
			else if (filePath.endsWith('.js')) headers['Content-Type'] = 'text/javascript';
			return new Response(file, { headers });
		}

		return new Response('Not Found', { status: 404 });
	},
});

console.log(`Listening on ${server.url}`);
