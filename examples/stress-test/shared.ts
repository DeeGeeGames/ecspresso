export const SCREEN_W = 1920;
export const SCREEN_H = 1080;
export const WORLD_W = SCREEN_W * 4;
export const WORLD_H = SCREEN_H * 4;
export const BALL_RADIUS = 3;
export const SPAWN_RATE = 5;
export const COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa29bfe, 0xfd79a8, 0x00cec9, 0xe17055];

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
