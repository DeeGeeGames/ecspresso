export const SCREEN_W = 1920;
export const SCREEN_H = 1080;
export const WORLD_W = SCREEN_W * 4;
export const WORLD_H = SCREEN_H * 4;
export const BALL_RADIUS = 3;
export const SPAWN_RATE = 5;
export const COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa29bfe, 0xfd79a8, 0x00cec9, 0xe17055];

export type EntityCountControl = {
	getCount: () => number;
	spawnAt: (x: number, y: number) => void;
	removeMany: (count: number) => void;
	onChange?: (count: number) => void;
};

export function createEntityCountInput(control: EntityCountControl): () => void {
	const wrap = document.createElement('div');
	wrap.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:999999;display:flex;gap:6px;align-items:center;padding:6px 10px;font:13px/1 monospace;background:#2a2a3e;color:#fff;border:1px solid #555;border-radius:4px';

	const label = document.createElement('span');
	label.textContent = 'Entities:';

	const input = document.createElement('input');
	input.type = 'number';
	input.min = '0';
	input.style.cssText = 'width:90px;padding:4px 6px;font:13px/1 monospace;background:#1a1a2e;color:#0f0;border:1px solid #555;border-radius:3px';

	const btn = document.createElement('button');
	btn.textContent = 'Set';
	btn.style.cssText = 'padding:4px 10px;font:13px/1 monospace;background:#1a1a2e;color:#0f0;border:1px solid #555;border-radius:3px;cursor:pointer';

	wrap.appendChild(label);
	wrap.appendChild(input);
	wrap.appendChild(btn);
	document.body.appendChild(wrap);

	const apply = () => {
		const target = Math.max(0, Math.floor(Number(input.value)));
		if (!Number.isFinite(target)) return;
		const current = control.getCount();
		if (target > current) {
			for (let i = 0; i < target - current; i++) {
				control.spawnAt(
					BALL_RADIUS + Math.random() * (WORLD_W - BALL_RADIUS * 2),
					BALL_RADIUS + Math.random() * (WORLD_H - BALL_RADIUS * 2),
				);
			}
		} else if (target < current) {
			control.removeMany(current - target);
		}
		const finalCount = control.getCount();
		input.value = String(finalCount);
		control.onChange?.(finalCount);
	};

	btn.addEventListener('click', apply);
	input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

	const refreshTimer = setInterval(() => {
		if (document.activeElement !== input) {
			input.value = String(control.getCount());
		}
	}, 500);

	return () => {
		clearInterval(refreshTimer);
		wrap.remove();
	};
}

export function createFpsOverlay(formatLines: (fps: number) => string): () => void {
	const el = document.createElement('div');
	el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999;padding:6px 10px;font:12px/1.4 monospace;background:rgba(0,0,0,0.6);color:#0f0;border:1px solid #333;border-radius:4px;pointer-events:none;min-width:140px;white-space:pre';
	document.body.appendChild(el);

	let lastTime = performance.now();
	let frames = 0;
	let rafId = 0;
	const loop = () => {
		frames++;
		const now = performance.now();
		if (now - lastTime >= 500) {
			const fps = Math.round((frames * 1000) / (now - lastTime));
			frames = 0;
			lastTime = now;
			el.textContent = formatLines(fps);
		}
		rafId = requestAnimationFrame(loop);
	};
	rafId = requestAnimationFrame(loop);

	return () => {
		cancelAnimationFrame(rafId);
		el.remove();
	};
}

export function createCollisionToggle(setEnabled: (enabled: boolean) => void): () => void {
	let enabled = true;
	const btn = document.createElement('button');
	btn.textContent = 'Collision: ON';
	btn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999;padding:6px 14px;font:13px/1 monospace;background:#2a2a3e;color:#0f0;border:1px solid #555;border-radius:4px;cursor:pointer';
	btn.addEventListener('click', () => {
		enabled = !enabled;
		setEnabled(enabled);
		btn.textContent = `Collision: ${enabled ? 'ON' : 'OFF'}`;
		btn.style.color = enabled ? '#0f0' : '#f55';
	});
	document.body.appendChild(btn);
	return () => { btn.remove(); };
}
