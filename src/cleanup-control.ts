/**
 * Capability passed to cleanup callbacks that may need to initiate disposal of
 * their owner. The request is deliberately non-blocking: cleanup must finish
 * before the owner's external disposal barrier can settle.
 */
export interface CleanupControl {
	/**
	 * Start disposal of the callback's owner without waiting on the cleanup
	 * callback that made the request. External `dispose()` callers still await
	 * the complete teardown and receive its failures.
	 */
	requestDisposal(): void;
}

/** @internal */
export function createCleanupControl(
	startDisposal: () => Promise<unknown>,
): CleanupControl {
	return Object.freeze({
		requestDisposal(): void {
			void startDisposal().catch(() => undefined);
		},
	});
}

/** @internal */
export function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
	let reject: (reason?: unknown) => void = () => undefined;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
