import { record, errorText } from './protocol';

type OwnedWorld = { dispose(): Promise<void> };
type Demo = {
	world: OwnedWorld & { initialize(): Promise<unknown>; update(dt: number): void };
	start(): void; setInput(x: number, y: number): void; read(): unknown;
};
function isDemo(value: unknown): value is Demo {
	if (!record(value) || !record(value['world'])) return false;
	const world = value['world'];
	return ['initialize', 'update', 'dispose'].every(key => typeof world[key] === 'function')
		&& ['start', 'setInput', 'read'].every(key => typeof value[key] === 'function');
}
const state: { demo?: Demo; timer?: ReturnType<typeof setInterval>; previous: number;
	worlds: Set<OwnedWorld>; urls: string[]; stopped: boolean; stopping?: Promise<void>; updates: number } = {
	previous: 0, worlds: new Set(), urls: [], stopped: false, updates: 0,
};
function send(data: Record<string, unknown>) { globalThis.postMessage(data); }
function moduleUrl(source: string) {
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	state.urls.push(url);
	return url;
}
function registerWorld(world: OwnedWorld) { state.worlds.add(world); }
async function dispose() {
	if (state.stopping) return state.stopping;
	state.stopped = true;
	clearInterval(state.timer);
	state.stopping = (async function () {
		const results = await Promise.allSettled(Array.from(state.worlds, world => world.dispose()));
		state.urls.forEach(url => URL.revokeObjectURL(url));
		const errors = results.filter(result => result.status === 'rejected').map(result => errorText(result.reason));
		send({ kind: 'disposed', worlds: state.worlds.size, updates: state.updates, errors });
	})();
	return state.stopping;
}
async function fail(error: unknown) {
	send({ kind: 'error', error: errorText(error) });
	await dispose();
}
function tick() {
	if (!state.demo || state.stopped) return;
	try {
		const now = performance.now();
		const dt = Math.min((now - state.previous) / 1000, 0.05);
		state.previous = now;
		state.demo.world.update(dt);
		const current = state.demo.read();
		if (!record(current)) throw new Error('read() must return game state.');
		state.updates += 1;
		send({ kind: 'tick', snapshot: current, dt, updates: state.updates });
	} catch (error) { void fail(error); }
}
async function start(data: Record<string, unknown>) {
	if (typeof data['runtime'] !== 'string' || typeof data['javascript'] !== 'string') throw new Error('Invalid game payload.');
	const runtimeUrl = moduleUrl(data['runtime']);
	// Only the real core package is available to edited source. The sandbox CSP
	// blocks network access; module blobs are created inside its opaque origin.
	const source = data['javascript'].replace(/from\s*(['"])ecspresso\1/g, `from '${runtimeUrl}'`);
	const loaded: unknown = await import(moduleUrl(source));
	if (!record(loaded) || typeof loaded['createDemo'] !== 'function') throw new Error('Export createDemo to run the game.');
	const candidate: unknown = loaded['createDemo'](registerWorld);
	if (!isDemo(candidate)) throw new Error('createDemo must return world, start, setInput, and read.');
	state.demo = candidate;
	registerWorld(candidate.world);
	await candidate.world.initialize();
	if (state.stopped) return;
	candidate.start();
	state.previous = performance.now();
	state.timer = setInterval(tick, 25);
	send({ kind: 'started' });
}
globalThis.addEventListener('message', function (event: MessageEvent<unknown>) {
	if (!record(event.data)) return;
	const data = event.data;
	if (data['kind'] === 'start') { void start(data).catch(fail); return; }
	if (data['kind'] === 'stop') { void dispose().catch(fail); return; }
	if (data['kind'] !== 'input' || typeof data['x'] !== 'number' || typeof data['y'] !== 'number') return;
	try { state.demo?.setInput(data['x'], data['y']); } catch (error) { void fail(error); }
});
