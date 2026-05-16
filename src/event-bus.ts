interface EventHandler<T> {
	callback: (data: T) => void;
	once: boolean;
}

export default
class EventBus<EventTypes> {
	private handlers: Map<keyof EventTypes, Array<EventHandler<any>>> = new Map();

	/**
	 * Subscribe to an event
	 */
	subscribe<E extends keyof EventTypes>(
		eventType: E,
		callback: (data: EventTypes[E]) => void
	): () => void {
		return this.addHandler(eventType, callback, false);
	}

	/**
	 * Subscribe to an event once
	 */
	once<E extends keyof EventTypes>(
		eventType: E,
		callback: (data: EventTypes[E]) => void
	): () => void {
		return this.addHandler(eventType, callback, true);
	}

	/**
	 * Unsubscribe a specific callback from an event by reference
	 * @returns true if the callback was found and removed, false otherwise
	 */
	unsubscribe<E extends keyof EventTypes>(
		eventType: E,
		callback: (data: EventTypes[E]) => void
	): boolean {
		const handlers = this.handlers.get(eventType);
		if (!handlers) return false;

		const index = handlers.findIndex(h => h.callback === callback);
		if (index === -1) return false;

		handlers.splice(index, 1);
		return true;
	}

	/**
	 * Internal method to add an event handler
	 */
	private addHandler<E extends keyof EventTypes>(
		eventType: E,
		callback: (data: EventTypes[E]) => void,
		once: boolean
	): () => void {
		let handlers = this.handlers.get(eventType);
		if (!handlers) {
			handlers = [];
			this.handlers.set(eventType, handlers);
		}

		const handler: EventHandler<any> = {
			callback,
			once
		};

		handlers.push(handler);

		// Return unsubscribe function
		return () => {
			const handlers = this.handlers.get(eventType);
			if (handlers) {
				const index = handlers.indexOf(handler);
				if (index !== -1) {
					handlers.splice(index, 1);
				}
			}
		};
	}

	/**
	 * Publish an event. Data is required unless EventTypes[E] extends void | undefined.
	 * Zero-allocation hot path: uses index-based iteration with a snapshot length
	 * so handlers added mid-publish are not called in the same publish cycle.
	 */
	publish<E extends keyof EventTypes>(
		eventType: EventTypes[E] extends void | undefined ? E : never,
	): void;
	publish<E extends keyof EventTypes>(
		eventType: E,
		data: EventTypes[E],
	): void;
	publish<E extends keyof EventTypes>(eventType: E, data?: EventTypes[E]): void {
		const handlers = this.handlers.get(eventType);
		if (!handlers || handlers.length === 0) return;

		// Snapshot length prevents calling handlers added mid-publish
		let hasOnce = false;
		const len = handlers.length;
		for (let i = 0; i < len && i < handlers.length; i++) {
			const handler = handlers[i];
			if (!handler) continue;
			handler.callback(data as EventTypes[E]);
			if (handler.once) hasOnce = true;
		}

		// Reverse splice to remove once-handlers without shifting earlier indices
		if (hasOnce) {
			for (let i = handlers.length - 1; i >= 0; i--) {
				if (handlers[i]?.once) {
					handlers.splice(i, 1);
				}
			}
		}
	}

	clear(): void {
		this.handlers.clear();
	}

	clearEvent<E extends keyof EventTypes>(eventType: E): void {
		this.handlers.delete(eventType);
	}
}
