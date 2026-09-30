export type EngineSession<E extends string> = {
	engine: E;
	destroy: () => void | Promise<void>;
};

export function createEngineSwitcher<E extends string>(options: {
	start: (engine: E) => Promise<() => void | Promise<void>>;
	onActive: (engine: E | null) => void;
	onError: (error: unknown) => void;
}) {
	const state: { session: EngineSession<E> | null; pending: Promise<void> } = {
		session: null,
		pending: Promise.resolve(),
	};

	async function transition(engine: E): Promise<void> {
		if (state.session?.engine === engine) return;
		const previous = state.session;
		state.session = null;
		options.onActive(null);
		try {
			await previous?.destroy();
			const destroy = await options.start(engine);
			state.session = { engine, destroy };
			options.onActive(engine);
		} catch (error) {
			options.onError(error);
			if (!previous) return;
			try {
				const destroy = await options.start(previous.engine);
				state.session = { engine: previous.engine, destroy };
				options.onActive(previous.engine);
			} catch (recoveryError) {
				options.onError(recoveryError);
			}
		}
	}

	function switchTo(engine: E): Promise<void> {
		state.pending = state.pending.then(() => transition(engine));
		return state.pending;
	}

	return { switchTo };
}
