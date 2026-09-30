import { isBevyRuntime } from './bevy-runtime';

try {
	const moduleUrl = new URL('./bevy/pkg/bevy_stress_test.js', document.baseURI).href;
	const module: unknown = await import(moduleUrl);
	if (!isBevyRuntime(module) || !('default' in module) || typeof module.default !== 'function') {
		throw new Error('Invalid Bevy WebAssembly module');
	}
	await module.default();
	Object.assign(window, { bevyRuntime: module });
	window.parent.postMessage({ type: 'bevy-ready' }, location.origin);
} catch (error) {
	window.parent.postMessage({ type: 'bevy-error', message: String(error) }, location.origin);
}
