/**
 * Shared helpers for ECSpresso micro-benchmarks.
 */

/** Deterministic PRNG used to seed benchmark inputs reproducibly. */
export function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return function(): number {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
	};
}

/** Render a row of strings as a padded table line. */
export function printRow(cells: string[], widths: number[]): void {
	const row = cells.map((c, i) => c.padStart(widths[i] ?? 8)).join('  ');
	console.log('  ' + row);
}
