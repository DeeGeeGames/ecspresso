export function typeCases(source: string) {
	return [
		{ name: 'baseline', source: source },
		{ name: 'valid', source: source.replace('\t\t\tentity.components.velocity.x = 3;\n', '').replace('\t\t\tconsole.log(entity.components.health);\n', '').replace("with: ['unknown']", "with: ['health']") },
		{ name: 'component-type-edit', source: source.replace('position: { x: number;', 'position: { x: string;') },
		{ name: 'component-arithmetic-edit', source: source.replace('velocity: { x: number;', 'velocity: { x: string;') },
		{ name: 'optional-dereference', source: source.replace('console.log(entity.components.health);', 'console.log(entity.components.health.current);') },
		{ name: 'query-without-health', source: source.replace("with: ['position', 'velocity'],", "with: ['position', 'velocity'], without: ['health'],") },
		{ name: 'component-name-edit', source: source.replace('health: { current:', 'armor: { current:') },
		{ name: 'query-add-health', source: source.replace("with: ['position', 'velocity']", "with: ['position', 'velocity', 'health']").replace("with: ['unknown']", "with: ['health']") },
		{ name: 'query-remove-velocity', source: source.replace("with: ['position', 'velocity']", "with: ['position']") },
		{ name: 'no-mutates', source: source.replace("\t\tmutates: ['position'],\n", '') },
		{ name: 'component-replacement-limit', source: source.replace('entity.components.velocity.x = 3;', 'entity.components.velocity = { x: 3, y: 4 };') },
		{ name: 'nested-readonly-limit', source: source.replace('velocity: { x: number; y: number };', 'velocity: { x: number; y: number; nested: { value: number } };').replace('entity.components.velocity.x = 3;', 'entity.components.velocity.nested.value = 3;') },
	];
}

function after(source: string, needle: string): number {
	const index = source.indexOf(needle);
	if (index < 0) throw new Error(`Probe missing: ${needle}`);
	return index + needle.length;
}
export function typeProbes(source: string) {
	return [
		{ name: 'with', offset: after(source, "with: ['") },
		{ name: 'components', offset: after(source, 'entity.components.') },
		{ name: 'position', offset: after(source, 'entity.components.po') },
		{ name: 'velocity', offset: after(source, 'entity.components.velocity') - 2 },
		{ name: 'settings', offset: after(source, 'resources.set') },
		{ name: 'health', offset: source.includes('entity.components.health') ? after(source, 'entity.components.hea') : after(source, 'hea') },
		{ name: 'dt', offset: after(source, 'queries, resources, d') },
	];
}
