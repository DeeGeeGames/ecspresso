import {
	SCREEN_W,
	SCREEN_H,
	WORLD_W,
	WORLD_H,
	BALL_RADIUS,
	createCollisionToggle,
	createEntityCountInput,
	createFpsOverlay,
} from './shared';

export type StartOptions = {
	initialCount: number;
	onCountChange: (count: number) => void;
};

type BevyModule = {
	default: (...args: unknown[]) => Promise<unknown>;
	start: (canvas_selector: string, initial_count: number) => void;
	set_collision_enabled: (enabled: boolean) => void;
	get_count: () => number;
	spawn_at: (x: number, y: number) => void;
	remove_many: (count: number) => void;
};

const CANVAS_ID = 'bevy-stress-canvas';
const WRAP_ID = 'bevy-stress-wrap';

let modulePromise: Promise<BevyModule> | null = null;
let bevyStarted = false;

const loadModule = (): Promise<BevyModule> => {
	if (modulePromise) return modulePromise;
	const glueUrl = new URL('./bevy/pkg/bevy_stress_test.js', document.baseURI).href;
	modulePromise = import(/* @vite-ignore */ glueUrl).then(async (mod) => {
		await mod.default();
		return mod as BevyModule;
	});
	return modulePromise;
};

const ensureCanvas = (): HTMLDivElement => {
	const existing = document.getElementById(WRAP_ID) as HTMLDivElement | null;
	if (existing) {
		existing.style.display = 'flex';
		return existing;
	}
	const wrap = document.createElement('div');
	wrap.id = WRAP_ID;
	wrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:1';

	const aspect = SCREEN_W / SCREEN_H;
	const inner = document.createElement('div');
	inner.style.cssText = `width:100vw;max-width:calc(100vh*${aspect});max-height:100vh;aspect-ratio:${SCREEN_W}/${SCREEN_H}`;

	const canvas = document.createElement('canvas');
	canvas.id = CANVAS_ID;
	canvas.style.cssText = 'display:block;width:100%;height:100%';

	inner.appendChild(canvas);
	wrap.appendChild(inner);
	document.body.appendChild(wrap);
	return wrap;
};

const adjustCount = (mod: BevyModule, target: number) => {
	const current = mod.get_count();
	if (target > current) {
		for (let i = 0; i < target - current; i++) {
			const x = BALL_RADIUS + Math.random() * (WORLD_W - BALL_RADIUS * 2);
			const y = BALL_RADIUS + Math.random() * (WORLD_H - BALL_RADIUS * 2);
			mod.spawn_at(x, y);
		}
	} else if (target < current) {
		mod.remove_many(current - target);
	}
};

export async function startBevy(options: StartOptions): Promise<() => void> {
	const mod = await loadModule();
	const wrap = ensureCanvas();

	if (!bevyStarted) {
		bevyStarted = true;
		mod.start(`#${CANVAS_ID}`, options.initialCount);
	} else {
		adjustCount(mod, options.initialCount);
	}

	const cleanupToggle = createCollisionToggle((enabled) => {
		mod.set_collision_enabled(enabled);
	});

	const cleanupCountInput = createEntityCountInput({
		getCount: () => mod.get_count(),
		spawnAt: (x, y) => { mod.spawn_at(x, y); },
		removeMany: (count) => { mod.remove_many(count); },
		onChange: options.onCountChange,
	});

	const cleanupOverlay = createFpsOverlay(
		(fps) => `Bevy 0.18 (wasm)\nFPS: ${fps}\nBalls: ${mod.get_count()}`,
	);

	return function destroy() {
		cleanupOverlay();
		cleanupCountInput();
		cleanupToggle();
		wrap.style.display = 'none';
	};
}
