interface PointerSurface {
	canvas: { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
	screen: { width: number; height: number };
}

/** Convert DOM pointer coordinates to the coordinate convention consumed by camera helpers. */
export function createPointerTransform(getSurface: () => PointerSurface | null, isometric = false) {
	return function transformPointer(clientX: number, clientY: number) {
		const surface = getSurface();
		if (!surface) return { x: clientX, y: clientY };
		const rect = surface.canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
		const x = (clientX - rect.left) * surface.screen.width / rect.width;
		const y = (clientY - rect.top) * surface.screen.height / rect.height;
		if (!isometric) return { x, y };

		// screenToIsoWorld and iso cursor zoom already subtract the client-space
		// canvas center. Preserve that center, normalizing only CSS scaling.
		return {
			x: rect.left + rect.width / 2 + x - surface.screen.width / 2,
			y: rect.top + rect.height / 2 + y - surface.screen.height / 2,
		};
	};
}
