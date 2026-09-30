import { element, record, position, errorText, type Position } from './protocol';

export type GameState = {
	player: Position; coins: Position[]; hazards: Position[];
	health: number; score: number; phase: string; immunity: number;
};
function gameState(value: unknown): value is GameState {
	return record(value) && position(value['player']) && Array.isArray(value['coins'])
		&& value['coins'].every(position) && Array.isArray(value['hazards']) && value['hazards'].every(position)
		&& typeof value['health'] === 'number' && typeof value['score'] === 'number'
		&& typeof value['phase'] === 'string' && typeof value['immunity'] === 'number';
}
export function createRunner(onState: (snapshot: GameState) => void) {
	const state: { frame?: HTMLIFrameElement; heartbeat: number; timer?: ReturnType<typeof setInterval>;
		phase: string; last?: GameState; runs: number; terminations: number; updates: number;
		pending?: { resolve: () => void; reject: (error: Error) => void };
		disposeResolve?: () => void; disposalError?: string; audits: unknown[] } = {
		heartbeat: 0, phase: 'idle', runs: 0, terminations: 0, updates: 0, audits: [],
	};
	function status(text: string) { element('game-status').textContent = text; }
	function terminate(reason: string) {
		clearInterval(state.timer);
		state.frame?.contentWindow?.postMessage({ kind: 'terminate' }, '*');
		state.frame?.remove();
		state.frame = undefined;
		state.phase = 'stopped';
		state.disposeResolve?.();
		state.terminations += 1;
		state.pending?.reject(new Error(reason));
		state.pending = undefined;
		status(reason);
	}
	window.addEventListener('message', function (event: MessageEvent<unknown>) {
		if (!state.frame || event.source !== state.frame.contentWindow || !record(event.data)) return;
		const data = event.data;
		state.heartbeat = performance.now();
		if (data['kind'] === 'booted') { state.pending?.resolve(); state.pending = undefined; return; }
		if (data['kind'] === 'started') { state.pending?.resolve(); state.pending = undefined; state.phase = 'running'; status('Collect all 8 beans. Dodge the hot sparks.'); return; }
		if (data['kind'] === 'error') { terminate(`Game stopped: ${String(data['error'])}. Fix the code, then Run again.`); return; }
		if (data['kind'] === 'disposed') {
			state.audits.push(data);
			if (state.audits.length > 30) state.audits.shift();
			if (Array.isArray(data['errors']) && data['errors'].length) {
				state.disposalError = `Cleanup reported: ${data['errors'].map(String).join('; ')}`;
				const warning = element('runtime-errors'); warning.hidden = false; warning.textContent = state.disposalError;
			}
			state.disposeResolve?.();
			return;
		}
		if (data['kind'] !== 'tick' || !gameState(data['snapshot'])) return;
		state.last = data['snapshot'];
		state.updates = typeof data['updates'] === 'number' ? data['updates'] : 0;
		onState(state.last);
	});
	function send(data: Record<string, unknown>) { state.frame?.contentWindow?.postMessage(data, '*'); }
	async function stop() {
		if (!state.frame) return;
		state.disposalError = undefined;
		const disposed = new Promise<void>(function (resolve) {
			const timer = setTimeout(function () { state.disposeResolve = undefined; resolve(); }, 1000);
			state.disposeResolve = function () { clearTimeout(timer); state.disposeResolve = undefined; resolve(); };
		});
		send({ kind: 'stop' });
		// Await normal cleanup; an unresponsive disposer still has a bounded stop.
		await disposed;
		terminate(state.disposalError ?? 'Stopped. Press Play to start again.');
	}
	async function run(javascript: string, runtime: string, workerSource: string, sandbox: string) {
		await stop();
		const frame = document.createElement('iframe');
		frame.title = 'Isolated game simulation';
		frame.setAttribute('sandbox', 'allow-scripts');
		frame.hidden = true;
		state.frame = frame;
		state.phase = 'starting';
		state.updates = 0;
		state.last = undefined;
		state.runs += 1;
		state.heartbeat = performance.now();
		status('Starting game…');
		const ready = new Promise<void>(function (resolve, reject) { state.pending = { resolve, reject }; });
		state.timer = setInterval(function () {
			if (document.hidden) { state.heartbeat = performance.now(); return; }
			const budget = state.phase === 'starting' ? 8000 : 2500;
			if (performance.now() - state.heartbeat < budget) return;
			terminate('Code took too long to respond. The simulation was terminated. Fix the code and Run again.');
		}, 250);
		frame.srcdoc = sandbox;
		element('simulation-host').replaceChildren(frame);
		await ready;
		const started = new Promise<void>(function (resolve, reject) { state.pending = { resolve, reject }; });
		send({ kind: 'start', javascript, runtime, workerSource });
		await started;
	}
	window.addEventListener('pagehide', () => terminate('Page closed.'));
	return { run, stop, send, snapshot: () => ({ ...state, frame: undefined, timer: undefined, pending: undefined, disposeResolve: undefined }) };
}
export type Runner = ReturnType<typeof createRunner>;
export async function fetchText(path: string): Promise<string> {
	const response = await fetch(new URL(path, import.meta.url));
	if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
	return response.text();
}
export async function sha256(source: string) {
	if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
		throw new Error('HTTPS is required for the editor and game. Open this site over HTTPS, or use localhost on this device.');
	}
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function loadRuntime() {
	const [runtime, workerSource, sandbox, manifestText] = await Promise.all([
		fetchText('./runtime.js'), fetchText('./simulation.js'), fetchText('./sandbox.html'), fetchText('./manifest.json'),
	]);
	const manifest: unknown = JSON.parse(manifestText);
	if (!record(manifest) || manifest['runtimeHash'] !== await sha256(runtime)) throw new Error('Game build mismatch. Reload to get the matching assets.');
	return { runtime, workerSource, sandbox, manifest };
}
export function reportError(error: unknown) { element('game-status').textContent = errorText(error); }
