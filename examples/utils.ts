export function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
	const element = document.getElementById(id);
	if (!(element instanceof type)) throw new Error(`Missing or invalid element: ${id}`);
	return element;
}

export function firstOf<T>(values: readonly T[]): T {
	const value = values[0];
	if (value === undefined) throw new Error('Expected a non-empty array');
	return value;
}

export function randomFrom<T>(values: readonly T[]): T {
	const value = values[Math.floor(Math.random() * values.length)];
	if (value === undefined) throw new Error('Expected a non-empty array');
	return value;
}
