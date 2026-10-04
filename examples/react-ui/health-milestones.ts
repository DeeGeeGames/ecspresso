/** Every threshold crossed downward, even when a long frame crosses several. */
export function crossedHealthMilestones(prev: number, next: number): number[] {
	return [75, 50, 25].filter(function crossedDown(threshold) {
		return prev > threshold && next <= threshold;
	});
}
