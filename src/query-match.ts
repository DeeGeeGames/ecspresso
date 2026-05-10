import type { Entity } from "./types";

/** Minimal lookup surface needed to evaluate `parentHas`. */
export interface MatchHost<ComponentTypes> {
	getEntity(entityId: number): Entity<ComponentTypes> | undefined;
	getParent(entityId: number): number | null;
}

/**
 * Returns true when `entity` matches the static portion of a query shape:
 * has every `with` component, no `without` component, and (if `parentHas`)
 * a direct parent that has every `parentHas` component. Shared between
 * QueryCache (membership maintenance) and ReactiveQueryManager (enter/exit
 * dispatch) so both use the same predicate.
 */
export function entityMatchesShape<ComponentTypes>(
	entity: Entity<ComponentTypes>,
	withC: ReadonlyArray<keyof ComponentTypes>,
	withoutC: ReadonlyArray<keyof ComponentTypes> | undefined,
	parentHas: ReadonlyArray<keyof ComponentTypes> | undefined,
	host: MatchHost<ComponentTypes>,
): boolean {
	const comps = entity.components as Record<keyof ComponentTypes, unknown>;
	for (const c of withC) {
		if (!(c in comps)) return false;
	}
	if (withoutC) {
		for (const c of withoutC) {
			if (c in comps) return false;
		}
	}
	if (parentHas && parentHas.length > 0) {
		const parentId = host.getParent(entity.id);
		if (parentId === null) return false;
		const parent = host.getEntity(parentId);
		if (!parent) return false;
		const parentComps = parent.components as Record<keyof ComponentTypes, unknown>;
		for (const c of parentHas) {
			if (!(c in parentComps)) return false;
		}
	}
	return true;
}
