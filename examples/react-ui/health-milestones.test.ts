import { expect, test } from 'bun:test';
import { crossedHealthMilestones } from './health-milestones';

test('logs downward threshold crossings once, including a long frame', () => {
	expect(crossedHealthMilestones(75.4, 75.2)).toEqual([]);
	expect(crossedHealthMilestones(75.2, 75)).toEqual([75]);
	expect(crossedHealthMilestones(75, 74.8)).toEqual([]);
	expect(crossedHealthMilestones(80, 20)).toEqual([75, 50, 25]);
	expect(crossedHealthMilestones(20, 80)).toEqual([]);
	expect(crossedHealthMilestones(0, 0)).toEqual([]);
});
