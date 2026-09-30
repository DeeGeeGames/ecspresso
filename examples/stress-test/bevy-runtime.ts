export interface BevyRuntime {
	start: (canvasSelector: string, initialCount: number) => void;
	set_collision_enabled: (enabled: boolean) => void;
	get_count: () => number;
	spawn_at: (x: number, y: number) => void;
	remove_many: (count: number) => void;
}

export function isBevyRuntime(value: unknown): value is BevyRuntime {
	return typeof value === 'object' && value !== null
		&& 'start' in value && typeof value.start === 'function'
		&& 'set_collision_enabled' in value && typeof value.set_collision_enabled === 'function'
		&& 'get_count' in value && typeof value.get_count === 'function'
		&& 'spawn_at' in value && typeof value.spawn_at === 'function'
		&& 'remove_many' in value && typeof value.remove_many === 'function';
}
