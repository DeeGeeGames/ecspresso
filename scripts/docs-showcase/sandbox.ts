import { record } from './protocol';

const state: { worker?: Worker; url?: string } = {};
function terminate() {
	state.worker?.terminate();
	if (state.url) URL.revokeObjectURL(state.url);
	state.worker = undefined;
	state.url = undefined;
}
window.addEventListener('message', function (event: MessageEvent<unknown>) {
	if (event.source !== parent || !record(event.data)) return;
	const data = event.data;
	if (data['kind'] === 'terminate') { terminate(); parent.postMessage({ kind: 'terminated' }, '*'); return; }
	if (data['kind'] !== 'start') { state.worker?.postMessage(data); return; }
	if (typeof data['workerSource'] !== 'string') return;
	terminate();
	state.url = URL.createObjectURL(new Blob([data['workerSource']], { type: 'text/javascript' }));
	state.worker = new Worker(state.url);
	state.worker.addEventListener('message', function (message: MessageEvent<unknown>) {
		parent.postMessage(message.data, '*');
	});
	state.worker.addEventListener('error', function (error) {
		parent.postMessage({ kind: 'error', error: error.message || 'The simulation could not start.' }, '*');
	});
	state.worker.postMessage(data);
});
window.addEventListener('pagehide', terminate);
parent.postMessage({ kind: 'booted' }, '*');
