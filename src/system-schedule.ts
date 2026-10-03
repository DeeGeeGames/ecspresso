import { assertSystemRef, type SystemRef, type SystemOrderingOptions } from './system-ref';
import type { SystemPhase } from './types';

interface SchedulableSystem extends SystemOrderingOptions {
	readonly label: string;
	readonly ref?: SystemRef;
	readonly phase?: SystemPhase;
	readonly priority?: number;
}

const phases: readonly SystemPhase[] = ['preUpdate', 'fixedUpdate', 'update', 'postUpdate', 'render'];

/** Assemble outside the update hot path; return only fully validated schedules. */
export function buildSystemSchedule<T extends SchedulableSystem>(systems: readonly T[]): Record<SystemPhase, T[]> {
	const bindings = new Map<SystemRef, T>();
	systems.forEach(system => {
		const phase = system.phase ?? 'update';
		if (!phases.includes(phase)) throw new Error(`System "${system.label}" has unsupported phase "${phase}". Expected ${phases.join(', ')}.`);
		if (!system.ref) return;
		assertSystemRef(system.ref);
		const existing = bindings.get(system.ref);
		if (existing) throw new Error(`System reference "${system.ref.name}" is bound to both "${existing.label}" and "${system.label}".`);
		bindings.set(system.ref, system);
	});

	const predecessors = new Map(systems.map(system => [system, new Set<T>()]));
	function addEdge(source: T, target: T): void {
		if (source === target) throw new Error(`System "${source.label}" cannot depend on itself.`);
		const sourcePhase = source.phase ?? 'update';
		const targetPhase = target.phase ?? 'update';
		if (phases.indexOf(sourcePhase) > phases.indexOf(targetPhase)) {
			throw new Error(`Ordering "${source.label}" (${sourcePhase}) before "${target.label}" (${targetPhase}) contradicts fixed phase order.`);
		}
		if (sourcePhase !== targetPhase) return;
		predecessors.get(target)?.add(source);
	}
	function resolve(ref: SystemRef, consumer: T): T {
		assertSystemRef(ref);
		const target = bindings.get(ref);
		if (!target) throw new Error(`System "${consumer.label}" references unbound system "${ref.name}". Register its producer before assembling the schedule.`);
		return target;
	}
	systems.forEach(system => {
		system.before?.forEach(ref => addEdge(system, resolve(ref, system)));
		system.after?.forEach(ref => addEdge(resolve(ref, system), system));
	});

	function orderPhase(phase: SystemPhase): T[] {
		// Stable sorting preserves registration order for equal priorities.
		const remaining = systems.filter(system => (system.phase ?? 'update') === phase)
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
		const ordered: T[] = [];
		const visited = new Set<T>();
		// Mutation here is confined to assembly scratch state, never the live schedule.
		while (remaining.length > 0) {
			const index = remaining.findIndex(system => Array.from(predecessors.get(system) ?? []).every(predecessor => visited.has(predecessor)));
			if (index === -1) throw new Error(`System ordering cycle in ${phase}: ${remaining.map(system => `"${system.label}"`).join(', ')}.`);
			const system = remaining.splice(index, 1)[0];
			if (!system) throw new Error('System schedule assembly lost an eligible system.');
			ordered.push(system);
			visited.add(system);
		}
		return ordered;
	}

	return {
		preUpdate: orderPhase('preUpdate'),
		fixedUpdate: orderPhase('fixedUpdate'),
		update: orderPhase('update'),
		postUpdate: orderPhase('postUpdate'),
		render: orderPhase('render'),
	};
}
