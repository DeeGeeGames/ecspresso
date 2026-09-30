export function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
export function element(id: string): HTMLElement {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Missing #${id}`);
	return node;
}
export function button(id: string): HTMLButtonElement {
	const node = element(id);
	if (!(node instanceof HTMLButtonElement)) throw new Error(`Missing button #${id}`);
	return node;
}
export type Position = { x: number; y: number };
export function position(value: unknown): value is Position {
	return record(value) && typeof value['x'] === 'number' && Number.isFinite(value['x'])
		&& typeof value['y'] === 'number' && Number.isFinite(value['y']);
}
