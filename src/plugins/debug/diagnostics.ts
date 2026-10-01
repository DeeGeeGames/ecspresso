/**
 * Diagnostics Plugin for ECSpresso
 *
 * Runtime diagnostics: FPS, entity count, per-system timing, per-phase timing,
 * and an optional DOM overlay for visual debugging.
 */

import { definePlugin } from 'ecspresso';
import type { SystemPhase } from 'ecspresso';

// ==================== Types ====================

export interface DiagnosticsData {
	fps: number;
	entityCount: number;
	systemTimings: ReadonlyMap<string, number>;
	phaseTimings: Readonly<Record<SystemPhase, number>>;
	averageFrameTime: number;
}

export interface DiagnosticsResourceTypes {
	diagnostics: DiagnosticsData;
}

export interface DiagnosticsPluginOptions<G extends string = 'diagnostics'> {
	/** System group name (default: 'diagnostics') */
	systemGroup?: G;
	/** Enable timing collection on initialize (default: true) */
	enableTimingOnInit?: boolean;
	/** Number of frames to sample for FPS average (default: 60) */
	fpsSampleCount?: number;
}

export interface DiagnosticsOverlayOptions {
	/** Corner position (default: 'top-left') */
	position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
	/** Milliseconds between DOM updates (default: 200) */
	updateInterval?: number;
	/** Show per-system timings (default: true) */
	showSystemTimings?: boolean;
	/** Maximum systems to show in overlay (default: 10) */
	maxSystemsShown?: number;
}

// ==================== Ring Buffer ====================

/**
 * Fixed-size circular buffer for frame timestamps.
 * Avoids Array.shift() allocation on every frame.
 */
function createRingBuffer(capacity: number) {
	const buffer = new Float64Array(capacity);
	let writeIndex = 0;
	let count = 0;

	return {
		push(value: number): void {
			buffer[writeIndex] = value;
			writeIndex = (writeIndex + 1) % capacity;
			if (count < capacity) count++;
		},

		/** Compute FPS from stored timestamps */
		computeFps(): number {
			if (count < 2) return 0;
			const newest = buffer[(writeIndex - 1 + capacity) % capacity] ?? 0;
			const oldest = buffer[(writeIndex - count + capacity) % capacity] ?? 0;
			const elapsed = newest - oldest;
			if (elapsed <= 0) return 0;
			return ((count - 1) / elapsed) * 1000;
		},

		/** Compute average frame time in ms */
		computeAverageFrameTime(): number {
			if (count < 2) return 0;
			const newest = buffer[(writeIndex - 1 + capacity) % capacity] ?? 0;
			const oldest = buffer[(writeIndex - count + capacity) % capacity] ?? 0;
			const elapsed = newest - oldest;
			if (elapsed <= 0) return 0;
			return elapsed / (count - 1);
		},

		get size(): number {
			return count;
		},
	};
}

// ==================== Plugin Factory ====================

export function createDiagnosticsPlugin<G extends string = 'diagnostics'>(
	options?: DiagnosticsPluginOptions<G>,
) {
	const {
		systemGroup = 'diagnostics',
		enableTimingOnInit = true,
		fpsSampleCount = 60,
	} = options ?? {};

	return definePlugin('diagnostics')
		.withResourceTypes<DiagnosticsResourceTypes>()
		.withLabels<'diagnostics-collect'>()
		.withGroups<G>()
		.install((world) => {
			const initialData: DiagnosticsData = {
				fps: 0,
				entityCount: 0,
				systemTimings: new Map(),
				phaseTimings: { preUpdate: 0, fixedUpdate: 0, update: 0, postUpdate: 0, render: 0 },
				averageFrameTime: 0,
			};

			const ringBuffer = createRingBuffer(fpsSampleCount);

			world.addResource('diagnostics', initialData);

			world
				.addSystem('diagnostics-collect')
				.setPriority(-999999)
				.inPhase('render')
				.inGroup(systemGroup)
				.setOnInitialize((ecs) => {
					if (enableTimingOnInit) {
						ecs.enableDiagnostics(true);
					}
				})
				.setOnDetach((ecs) => {
					ecs.enableDiagnostics(false);
				})
				.setProcess(({ ecs }) => {
					const now = performance.now();
					ringBuffer.push(now);

					const resource = ecs.getResource('diagnostics');
					const updated: DiagnosticsData = {
						fps: ringBuffer.computeFps(),
						entityCount: ecs.entityCount,
						systemTimings: ecs.systemTimings,
						phaseTimings: ecs.phaseTimings,
						averageFrameTime: ringBuffer.computeAverageFrameTime(),
					};

					// Mutate fields on the existing resource object to avoid allocation
					(resource as { -readonly [K in keyof DiagnosticsData]: DiagnosticsData[K] }).fps = updated.fps;
					(resource as { -readonly [K in keyof DiagnosticsData]: DiagnosticsData[K] }).entityCount = updated.entityCount;
					(resource as { -readonly [K in keyof DiagnosticsData]: DiagnosticsData[K] }).systemTimings = updated.systemTimings;
					(resource as { -readonly [K in keyof DiagnosticsData]: DiagnosticsData[K] }).phaseTimings = updated.phaseTimings;
					(resource as { -readonly [K in keyof DiagnosticsData]: DiagnosticsData[K] }).averageFrameTime = updated.averageFrameTime;
				});
		});
}

// ==================== Overlay Helper ====================

const POSITION_STYLES: Record<NonNullable<DiagnosticsOverlayOptions['position']>, string> = {
	'top-left': 'top:8px;left:8px',
	'top-right': 'top:8px;right:8px',
	'bottom-left': 'bottom:8px;left:8px',
	'bottom-right': 'bottom:8px;right:8px',
} as const;

/**
 * Create a DOM overlay that displays diagnostics data.
 * Returns a cleanup function that removes the element and clears the interval.
 *
 * @param ecs An ECSpresso instance with the diagnostics resource
 * @param options Overlay configuration
 * @returns Cleanup function
 */
export function createDiagnosticsOverlay<
	R extends DiagnosticsResourceTypes,
>(
	ecs: { getResource<K extends keyof R>(key: K): R[K] },
	options?: DiagnosticsOverlayOptions,
): () => void {
	const {
		position = 'top-left',
		updateInterval = 200,
		showSystemTimings = true,
		maxSystemsShown = 10,
	} = options ?? {};

	const el = document.createElement('div');
	el.style.cssText = `position:fixed;${POSITION_STYLES[position]};z-index:999999;background:rgba(0,0,0,0.8);color:#0f0;font:12px/1.4 monospace;padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre`;
	document.body.appendChild(el);

	const intervalId = setInterval(() => {
		const d = ecs.getResource('diagnostics' as keyof R) as DiagnosticsData;

		const lines: string[] = [
			`FPS: ${d.fps.toFixed(0)}`,
			`Frame: ${d.averageFrameTime.toFixed(2)}ms`,
			`Entities: ${d.entityCount}`,
		];

		const phases = d.phaseTimings;
		lines.push(
			`Phases: pre=${phases.preUpdate.toFixed(2)} fix=${phases.fixedUpdate.toFixed(2)} upd=${phases.update.toFixed(2)} post=${phases.postUpdate.toFixed(2)} ren=${phases.render.toFixed(2)}`,
		);

		if (showSystemTimings && d.systemTimings.size > 0) {
			lines.push('--- Systems ---');
			const sorted = [...d.systemTimings.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, maxSystemsShown);
			for (const [label, ms] of sorted) {
				lines.push(`  ${label}: ${ms.toFixed(3)}ms`);
			}
		}

		el.textContent = lines.join('\n');
	}, updateInterval);

	return () => {
		clearInterval(intervalId);
		el.remove();
	};
}
