/**
 * Detection Plugin for ECSpresso
 *
 * Provides automatic proximity detection for entities. Entities with a
 * `detector` component get their `detectedEntities` populated each frame
 * with nearby entities that match the configured collision layer filter,
 * sorted by distance ascending (nearest first).
 *
 * Uses the spatial-index plugin for efficient range queries.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from 'ecspresso';
import type { TransformWorldConfig } from '../spatial/transform';
import type { SpatialIndexResourceTypes } from '../spatial/spatial-index';
import type { CollisionComponentTypes } from '../physics/collision';

// ==================== Component Types ====================

/**
 * Configures proximity detection for an entity.
 */
export interface Detector {
	/** Detection radius in world units */
	range: number;
	/** Only detect entities on these collision layers */
	layerFilter: readonly string[];
	/** Maximum number of results to track (default: 32) */
	maxResults: number;
}

/**
 * A detected entity with its squared distance from the detector.
 */
export interface DetectedEntry {
	entityId: number;
	distanceSq: number;
}

/**
 * Auto-populated list of detected entities, sorted by distance ascending.
 */
export interface DetectedEntities {
	entities: readonly DetectedEntry[];
}

/**
 * Component types provided by the detection plugin.
 */
export interface DetectionComponentTypes {
	detector: Detector;
	detectedEntities: DetectedEntities;
}

// ==================== Event Types ====================

/**
 * Event fired when a new entity enters detection range.
 */
export interface DetectionGainedEvent {
	/** The entity doing the detecting */
	entityId: number;
	/** The entity that was detected */
	detectedId: number;
}

/**
 * Event fired when an entity leaves detection range.
 */
export interface DetectionLostEvent {
	/** The entity doing the detecting */
	entityId: number;
	/** The entity that was lost */
	lostId: number;
}

/**
 * Event types provided by the detection plugin.
 */
export interface DetectionEventTypes {
	detectionGained: DetectionGainedEvent;
	detectionLost: DetectionLostEvent;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the detection plugin's provided types.
 */
export type DetectionWorldConfig = WorldConfigFrom<DetectionComponentTypes, DetectionEventTypes>;

// ==================== Plugin Options ====================

export interface DetectionPluginOptions<G extends string = 'ai'> extends BasePluginOptions<G> {}

// ==================== Helper Functions ====================

/**
 * Create a detector component.
 *
 * @param range Detection radius in world units
 * @param layerFilter Only detect entities on these collision layers
 * @param maxResults Maximum results to track (default: 32)
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createDetector(300, ['enemy']),
 *   ...createLocalTransform(400, 400),
 * });
 * ```
 */
export function createDetector(
	range: number,
	layerFilter: readonly string[],
	maxResults = 32,
): Pick<DetectionComponentTypes, 'detector'> {
	return { detector: { range, layerFilter, maxResults } };
}

/**
 * Check whether an entity has any detected targets.
 *
 * @param ecs  ECS world instance
 * @param entityId Entity with a detector component
 * @returns true if detectedEntities contains at least one entry
 *
 * @example
 * ```typescript
 * if (hasDetectedTargets(ecs, guardId)) {
 *   // transition to chase
 * }
 * ```
 */
export function hasDetectedTargets(
	ecs: { getComponent(entityId: number, name: 'detectedEntities'): DetectedEntities | undefined },
	entityId: number,
): boolean {
	const detected = ecs.getComponent(entityId, 'detectedEntities');
	return (detected?.entities.length ?? 0) > 0;
}

// ==================== Plugin Factory ====================

function compareByDistance(a: DetectedEntry, b: DetectedEntry): number {
	return a.distanceSq - b.distanceSq;
}

/**
 * Create a detection plugin for ECSpresso.
 *
 * Populates `detectedEntities` each frame with nearby entities matching
 * the detector's layer filter, sorted by distance (nearest first).
 * Publishes `detectionGained`/`detectionLost` events on transitions.
 *
 * Requires the spatial-index and transform plugins to be installed.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createCollisionPlugin({ layers }))
 *   .withPlugin(createSpatialIndexPlugin())
 *   .withPlugin(createDetectionPlugin())
 *   .build();
 *
 * // Read nearest detected entity:
 * const detected = ecs.getComponent(turretId, 'detectedEntities');
 * const nearest = detected?.entities[0];
 * ```
 */
export function createDetectionPlugin<G extends string = 'ai'>(
	options?: DetectionPluginOptions<G>,
) {
	const {
		systemGroup = 'ai',
		priority = 500,
		phase = 'update',
	} = options ?? {};

	// Per-detector tracking of previous frame's detected set for event diffing
	const previousSets = new Map<number, Set<number>>();
	const currentSet = new Set<number>();
	const candidateBuf: number[] = [];
	// Cache: layerFilter array → Set for O(1) lookups
	const layerFilterCache = new WeakMap<readonly string[], Set<string>>();

	return definePlugin('detection')
		.withComponentTypes<DetectionComponentTypes>()
		.withEventTypes<DetectionEventTypes>()
		.withLabels<'detection-scan'>()
		.withGroups<G>()
		.requires<
			TransformWorldConfig &
			WorldConfigFrom<Pick<CollisionComponentTypes<string>, 'collisionLayer'>> &
			WorldConfigFrom<{}, {}, SpatialIndexResourceTypes>
		>()
		.install((world) => {
			world.registerDispose('detector', ({ entityId }) => {
				previousSets.delete(entityId);
			});

			world
				.addSystem('detection-scan')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('detectors', {
					with: ['detector', 'worldTransform'],
				})
				.setProcess(({ queries, ecs }) => {
					const spatialIndex = ecs.getResource('spatialIndex');

					for (const entity of queries.detectors) {
						const { detector, worldTransform } = entity.components;

						candidateBuf.length = 0;
						spatialIndex.queryRadiusInto(worldTransform.x, worldTransform.y, detector.range, candidateBuf);

						// Build sorted results, filtering by layer and excluding self
						const entries: DetectedEntry[] = [];

						let filterSet = layerFilterCache.get(detector.layerFilter);
						if (!filterSet) {
							filterSet = new Set(detector.layerFilter);
							layerFilterCache.set(detector.layerFilter, filterSet);
						}

						for (const candidateId of candidateBuf) {
							if (candidateId === entity.id) continue;
							if (!ecs.getEntity(candidateId)) continue;

							const layer = ecs.getComponent(candidateId, 'collisionLayer');
							if (!layer) continue;
							if (!filterSet.has(layer.layer)) continue;

							const candidateTransform = ecs.getComponent(candidateId, 'worldTransform');
							if (!candidateTransform) continue;

							const dx = candidateTransform.x - worldTransform.x;
							const dy = candidateTransform.y - worldTransform.y;
							entries.push({ entityId: candidateId, distanceSq: dx * dx + dy * dy });
						}

						entries.sort(compareByDistance);
						const capped = entries.length > detector.maxResults
							? entries.slice(0, detector.maxResults)
							: entries;

						// Update or add the detectedEntities component
						const existing = ecs.getComponent(entity.id, 'detectedEntities');
						if (existing) {
							(existing as { entities: readonly DetectedEntry[] }).entities = capped;
							ecs.markChangedIfTracked(entity.id, 'detectedEntities');
						} else {
							ecs.addComponent(entity.id, 'detectedEntities', { entities: capped });
						}

						// Diff against previous frame for events
						const prev = previousSets.get(entity.id);
						currentSet.clear();
						for (const entry of capped) {
							currentSet.add(entry.entityId);
						}

						if (prev) {
							// Detect gained
							for (const id of currentSet) {
								if (!prev.has(id)) {
									ecs.eventBus.publish('detectionGained', {
										entityId: entity.id,
										detectedId: id,
									});
								}
							}
							// Detect lost
							for (const id of prev) {
								if (!currentSet.has(id)) {
									ecs.eventBus.publish('detectionLost', {
										entityId: entity.id,
										lostId: id,
									});
								}
							}
							// Update previous set in place
							prev.clear();
							for (const id of currentSet) {
								prev.add(id);
							}
						} else {
							// First frame — all are gained
							const newSet = new Set<number>();
							for (const entry of capped) {
								newSet.add(entry.entityId);
								ecs.eventBus.publish('detectionGained', {
									entityId: entity.id,
									detectedId: entry.entityId,
								});
							}
							previousSets.set(entity.id, newSet);
						}
					}
				});
		});
}
