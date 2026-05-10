import type { Entity } from "./types";
import { entityMatchesShape, type MatchHost } from "./query-match";

/**
 * Host interface that QueryCache uses to read EntityManager state.
 * Decouples QueryCache from EntityManager's private fields.
 */
export interface QueryCacheHost<ComponentTypes> extends MatchHost<ComponentTypes> {
	getChildren(parentId: number): readonly number[];
	allEntities(): IterableIterator<Entity<ComponentTypes>>;
	componentIndex(component: keyof ComponentTypes): Set<number> | undefined;
}

interface CacheEntry<ComponentTypes> {
	with: ReadonlyArray<keyof ComponentTypes>;
	without: ReadonlyArray<keyof ComponentTypes>;
	parentHas: ReadonlyArray<keyof ComponentTypes>;
	members: Set<number>;
}

function makeKey(
	withC: ReadonlyArray<PropertyKey>,
	withoutC: ReadonlyArray<PropertyKey>,
	parentHas: ReadonlyArray<PropertyKey>,
): string {
	const a = withC.length === 0 ? '' : [...withC].map(String).sort().join(',');
	const b = withoutC.length === 0 ? '' : [...withoutC].map(String).sort().join(',');
	const c = parentHas.length === 0 ? '' : [...parentHas].map(String).sort().join(',');
	return `${a}|${b}|${c}`;
}

/**
 * Maintains incrementally-updated Sets of entity IDs matching the static
 * portion of registered query shapes (with / without / parentHas).
 * EntityManager calls the on* hooks on component add/remove, entity
 * removal, and parent change. The `changed` filter is applied as a
 * post-pass by the caller, since its threshold advances each tick.
 */
export default class QueryCache<ComponentTypes> {
	private readonly host: QueryCacheHost<ComponentTypes>;
	private readonly caches: Map<string, CacheEntry<ComponentTypes>> = new Map();
	private readonly byComp: Map<keyof ComponentTypes, Array<CacheEntry<ComponentTypes>>> = new Map();
	private readonly byParentComp: Map<keyof ComponentTypes, Array<CacheEntry<ComponentTypes>>> = new Map();

	constructor(host: QueryCacheHost<ComponentTypes>) {
		this.host = host;
	}

	/**
	 * Returns the Set of entity IDs matching the (with, without, parentHas)
	 * shape. Caches are interned by canonical shape — identical shapes share
	 * a single Set across systems. Cold-start populates by iterating the
	 * smallest matching component index.
	 */
	getOrCreate(
		withC: ReadonlyArray<keyof ComponentTypes>,
		withoutC: ReadonlyArray<keyof ComponentTypes>,
		parentHas: ReadonlyArray<keyof ComponentTypes>,
	): Set<number> {
		const key = makeKey(withC, withoutC, parentHas);
		const existing = this.caches.get(key);
		if (existing) return existing.members;

		const entry: CacheEntry<ComponentTypes> = {
			with: [...withC],
			without: [...withoutC],
			parentHas: [...parentHas],
			members: new Set(),
		};
		this.caches.set(key, entry);

		for (const c of entry.with) pushTo(this.byComp, c, entry);
		for (const c of entry.without) pushTo(this.byComp, c, entry);
		for (const c of entry.parentHas) pushTo(this.byParentComp, c, entry);

		this.populate(entry);
		return entry.members;
	}

	/** Test-only: returns the number of distinct interned shapes. */
	get cacheCount(): number {
		return this.caches.size;
	}

	private populate(entry: CacheEntry<ComponentTypes>): void {
		const host = this.host;
		const required = entry.with;
		if (required.length === 0) {
			for (const e of host.allEntities()) {
				if (this.matches(e, entry)) entry.members.add(e.id);
			}
			return;
		}

		let smallest = required[0];
		if (smallest === undefined) return;
		let smallestSize = host.componentIndex(smallest)?.size ?? 0;
		for (let i = 1; i < required.length; i++) {
			const c = required[i];
			if (c === undefined) continue;
			const s = host.componentIndex(c)?.size ?? 0;
			if (s < smallestSize) { smallest = c; smallestSize = s; }
		}
		const candidates = host.componentIndex(smallest);
		if (!candidates || candidates.size === 0) return;
		for (const id of candidates) {
			const e = host.getEntity(id);
			if (!e) continue;
			if (this.matches(e, entry)) entry.members.add(id);
		}
	}

	private matches(entity: Entity<ComponentTypes>, entry: CacheEntry<ComponentTypes>): boolean {
		return entityMatchesShape(entity, entry.with, entry.without, entry.parentHas, this.host);
	}

	private reeval(entityId: number, entry: CacheEntry<ComponentTypes>): void {
		const e = this.host.getEntity(entityId);
		if (!e) {
			entry.members.delete(entityId);
			return;
		}
		if (this.matches(e, entry)) {
			entry.members.add(entityId);
		} else {
			entry.members.delete(entityId);
		}
	}

	onComponentChanged(entityId: number, componentName: keyof ComponentTypes): void {
		const direct = this.byComp.get(componentName);
		if (direct) {
			for (const cache of direct) this.reeval(entityId, cache);
		}
		const parentRel = this.byParentComp.get(componentName);
		if (parentRel && parentRel.length > 0) {
			const children = this.host.getChildren(entityId);
			if (children.length > 0) {
				for (const cache of parentRel) {
					for (const childId of children) this.reeval(childId, cache);
				}
			}
		}
	}

	onParentChanged(childId: number): void {
		for (const entry of this.caches.values()) {
			if (entry.parentHas.length > 0) this.reeval(childId, entry);
		}
	}

	/**
	 * Drops the entity from every cache. For parentHas caches, also drops
	 * direct children — once this entity is gone, the parent-link severs
	 * and children stop matching. Cascade-removed children fire their own
	 * beforeRemoved first, so the extra delete is a harmless no-op there.
	 */
	onEntityRemoved(entityId: number): void {
		let anyParentHas = false;
		for (const entry of this.caches.values()) {
			entry.members.delete(entityId);
			if (entry.parentHas.length > 0) anyParentHas = true;
		}
		if (!anyParentHas) return;
		const children = this.host.getChildren(entityId);
		if (children.length === 0) return;
		for (const entry of this.caches.values()) {
			if (entry.parentHas.length === 0) continue;
			for (const cid of children) entry.members.delete(cid);
		}
	}
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(value);
	} else {
		map.set(key, [value]);
	}
}
