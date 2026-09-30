import {
	SCREEN_W,
	SCREEN_H,
	createCollisionToggle,
	createEntityCountInput,
	createFpsOverlay,
} from './shared';
import { isBevyRuntime, type BevyRuntime } from './bevy-runtime';

export type StartOptions = {
	initialCount: number;
	onCountChange: (count: number) => void;
};

function loadRuntime(frame: HTMLIFrameElement): Promise<BevyRuntime> {
	return new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => finish(new Error('Bevy initialization timed out')), 30_000);

		function finish(error?: Error, runtime?: BevyRuntime): void {
			window.clearTimeout(timeoutId);
			window.removeEventListener('message', onMessage);
			if (error) return reject(error);
			if (!runtime) return reject(new Error('Bevy runtime is missing'));
			resolve(runtime);
		}

		function onMessage(event: MessageEvent<unknown>): void {
			if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
			const data = event.data;
			if (typeof data !== 'object' || data === null || !('type' in data)) return;
			if (data.type === 'bevy-error') {
				return finish(new Error('message' in data ? String(data.message) : 'Bevy initialization failed'));
			}
			if (data.type !== 'bevy-ready' || !frame.contentWindow) return;
			const runtime: unknown = Reflect.get(frame.contentWindow, 'bevyRuntime');
			if (!isBevyRuntime(runtime)) return finish(new Error('Invalid Bevy runtime'));
			finish(undefined, runtime);
		}

		window.addEventListener('message', onMessage);
		frame.src = new URL('./bevy-frame.html', document.baseURI).href;
	});
}

export async function startBevy(options: StartOptions): Promise<() => void> {
	const wrap = document.createElement('div');
	wrap.id = 'bevy-stress-wrap';
	wrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:1';
	const frame = document.createElement('iframe');
	frame.title = 'Bevy benchmark';
	frame.style.cssText = `border:0;width:100vw;max-width:calc(100vh*${SCREEN_W / SCREEN_H});max-height:100vh;aspect-ratio:${SCREEN_W}/${SCREEN_H}`;
	wrap.appendChild(frame);
	document.body.appendChild(wrap);

	try {
		const mod = await loadRuntime(frame);
		mod.start('#bevy-stress-canvas', options.initialCount);
		const cleanupToggle = createCollisionToggle(mod.set_collision_enabled);
		const cleanupCountInput = createEntityCountInput({
			getCount: mod.get_count,
			spawnAt: mod.spawn_at,
			removeMany: mod.remove_many,
			onChange: options.onCountChange,
		});
		const cleanupOverlay = createFpsOverlay(
			(fps) => `Bevy 0.18 (wasm)\nFPS: ${fps}\nBalls: ${mod.get_count()}`,
		);

		return function destroy() {
			cleanupOverlay();
			cleanupCountInput();
			cleanupToggle();
			wrap.remove();
		};
	} catch (error) {
		wrap.remove();
		throw error;
	}
}
