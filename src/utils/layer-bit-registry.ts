/**
 * Lazy monotonic registry mapping layer name → unique bit. Lets pair
 * filtering use a single `(a.collidesWithMask & b.layerBit)` check
 * instead of `Array.includes` on every collision pair.
 *
 * One registry per dimension (2D and 3D) — user-defined layer namespaces
 * are independent, so bits should not be shared across systems.
 *
 * Maximum 32 layers per registry (one per bit in a 32-bit signed int).
 * Crossing the limit throws on the next `getLayerBit` call.
 */
export interface LayerBitRegistry {
	getLayerBit(layer: string): number;
	/** OR of `getLayerBit` for every entry. Cached by array reference. */
	getCollidesWithMask(collidesWith: readonly string[]): number;
}

export function createLayerBitRegistry(label: string): LayerBitRegistry {
	const layerBits = new Map<string, number>();
	const maskCache = new WeakMap<readonly string[], number>();
	let nextBit = 1;

	function getLayerBit(layer: string): number {
		const existing = layerBits.get(layer);
		if (existing !== undefined) return existing;
		if (nextBit === 0) {
			throw new Error(
				`[ecspresso] ${label} layer bitmask overflow: more than 32 distinct layers registered`,
			);
		}
		const bit = nextBit;
		layerBits.set(layer, bit);
		// `<<= 1` rolls 1<<31 to 0, which is detected on the next call.
		nextBit <<= 1;
		return bit;
	}

	function getCollidesWithMask(collidesWith: readonly string[]): number {
		const cached = maskCache.get(collidesWith);
		if (cached !== undefined) return cached;
		let mask = 0;
		for (let i = 0; i < collidesWith.length; i++) {
			mask |= getLayerBit(collidesWith[i]!);
		}
		maskCache.set(collidesWith, mask);
		return mask;
	}

	return { getLayerBit, getCollidesWithMask };
}
