interface EventHandler<T> {
	callback: (data: T) => void;
	once: boolean;
	active: boolean;
}

export default
class EventBus<EventTypes> {
	private handlers: Map<keyof EventTypes, Array<EventHandler<any>>> = new Map();
	private readonly dirtyEvents: Set<keyof EventTypes> = new Set();
	private publishDepth = 0;
	private closed = false;

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

		const handler = handlers.find(candidate => candidate.active && candidate.callback === callback);
		if (!handler) return false;

		this.removeHandler(eventType, handler);
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
		if (this.closed) {
			throw new Error('EventBus is closed');
		}

		const handlers = this.handlers.get(eventType) ?? [];
		this.handlers.set(eventType, handlers);

		const handler: EventHandler<any> = {
			callback,
			once,
			active: true,
		};

		handlers.push(handler);

		// Return unsubscribe function
		return () => {
			this.removeHandler(eventType, handler);
		};
	}

	private removeHandler<E extends keyof EventTypes>(eventType: E, handler: EventHandler<EventTypes[E]>): void {
		if (!handler.active) return;

		handler.active = false;
		this.dirtyEvents.add(eventType);
		if (this.publishDepth === 0) {
			this.compactEvent(eventType);
		}
	}

	private compactEvent<E extends keyof EventTypes>(eventType: E): void {
		const handlers = this.handlers.get(eventType);
		if (!handlers) {
			this.dirtyEvents.delete(eventType);
			return;
		}

		const activeHandlers = handlers.filter(handler => handler.active);
		if (activeHandlers.length === 0) {
			this.handlers.delete(eventType);
		} else {
			this.handlers.set(eventType, activeHandlers);
		}
		this.dirtyEvents.delete(eventType);
	}

	private compactDirtyEvents(): void {
		for (const eventType of this.dirtyEvents) {
			this.compactEvent(eventType);
		}
	}

	/**
	 * Publish an event. Data is required unless EventTypes[E] extends void | undefined.
	 * Snapshot length prevents handlers added mid-publish from being called in the same cycle.
	 * Removed handlers remain as inactive tombstones until publication finishes, so removing
	 * one handler cannot shift an unrelated handler into the current index.
	 */
	publish<E extends keyof EventTypes>(
		eventType: EventTypes[E] extends void | undefined ? E : never,
	): void;
	publish<E extends keyof EventTypes>(
		eventType: E,
		data: EventTypes[E],
	): void;
	publish<E extends keyof EventTypes>(eventType: E, data?: EventTypes[E]): void {
		if (this.closed) return;

		const handlers = this.handlers.get(eventType);
		if (!handlers || handlers.length === 0) return;

		const len = handlers.length;
		this.publishDepth++;
		try {
			for (let i = 0; i < len; i++) {
				const handler = handlers[i];
				if (!handler?.active) continue;
				if (handler.once) {
					this.removeHandler(eventType, handler);
				}
				handler.callback(data as EventTypes[E]);
			}
		} finally {
			this.publishDepth--;
			if (this.publishDepth === 0) {
				this.compactDirtyEvents();
			}
		}
	}

	clear(): void {
		for (const handlers of this.handlers.values()) {
			for (const handler of handlers) {
				handler.active = false;
			}
		}
		this.handlers.clear();
		this.dirtyEvents.clear();
	}

	clearEvent<E extends keyof EventTypes>(eventType: E): void {
		const handlers = this.handlers.get(eventType);
		if (handlers) {
			for (const handler of handlers) {
				handler.active = false;
			}
		}
		this.handlers.delete(eventType);
		this.dirtyEvents.delete(eventType);
	}

	/** @internal Prevent new subscriptions and event delivery during world disposal. */
	close(): void {
		this.clear();
		this.closed = true;
	}
}
