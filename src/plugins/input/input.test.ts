import { describe, test, expect } from 'bun:test';
import ECSpresso from '../../ecspresso';
import type { WorldConfigFrom } from '../../type-utils';
import {
	createInputPlugin,
	createActionBinding,
	gamepadButtonsOn,
	gamepadAxisOn,
	type GamepadLike,
	type InputResourceTypes,
	type InputState,
	type ActionState,
	type ActionMap,
} from './input';

interface TestComponents {}
interface TestEvents {}
interface TestResources extends InputResourceTypes {}

interface MockPad {
	id: string;
	connected: boolean;
	buttons: Array<{ pressed: boolean; value: number }>;
	axes: number[];
}

function mockPad(id = 'mock-pad', buttonCount = 16, axisCount = 4): MockPad {
	return {
		id,
		connected: true,
		buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, value: 0 })),
		axes: Array.from({ length: axisCount }, () => 0),
	};
}

function mockPoll(pads: Array<MockPad | null>): () => ReadonlyArray<GamepadLike | null> {
	return () => pads;
}

function pressButton(pad: MockPad, index: number, value = 1) {
	pad.buttons[index] = { pressed: true, value };
}

function releaseButton(pad: MockPad, index: number) {
	pad.buttons[index] = { pressed: false, value: 0 };
}

function createWorld(options?: {
	actions?: ActionMap;
	target?: EventTarget;
	pads?: Array<MockPad | null>;
	deadzone?: number;
	players?: Record<string, ActionMap>;
}) {
	const target = options?.target ?? new EventTarget();
	const ecs = ECSpresso
		.create()
		.withComponentTypes<TestComponents>()
		.withEventTypes<TestEvents>()
		.withResourceTypes<TestResources>()
		.withPlugin(createInputPlugin({
			target,
			actions: options?.actions,
			players: options?.players,
			gamepad: options?.pads ? { poll: mockPoll(options.pads), deadzone: options.deadzone } : undefined,
		}))
		.build();
	return { ecs, target };
}

async function initAndUpdate(ecs: ECSpresso<WorldConfigFrom<TestComponents, TestEvents, TestResources>>, dt = 0.016) {
	await ecs.initialize();
	ecs.update(dt);
}

function dispatchKeyDown(target: EventTarget, key: string, repeat = false) {
	const event = new Event('keydown');
	Object.assign(event, { key, repeat });
	target.dispatchEvent(event);
}

function dispatchKeyUp(target: EventTarget, key: string) {
	const event = new Event('keyup');
	Object.assign(event, { key });
	target.dispatchEvent(event);
}

function dispatchPointerMove(target: EventTarget, clientX: number, clientY: number) {
	const event = new Event('pointermove');
	Object.assign(event, { clientX, clientY });
	target.dispatchEvent(event);
}

function dispatchPointerDown(target: EventTarget, button: number) {
	const event = new Event('pointerdown');
	Object.assign(event, { button });
	target.dispatchEvent(event);
}

function dispatchPointerUp(target: EventTarget, button: number) {
	const event = new Event('pointerup');
	Object.assign(event, { button });
	target.dispatchEvent(event);
}

describe('Input Plugin', () => {
	describe('Keyboard', () => {
		test('isDown true after keydown, false after keyup', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchKeyDown(target, 'a');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.isDown('a')).toBe(true);

			dispatchKeyUp(target, 'a');
			ecs.update(0.016);

			expect(input.keyboard.isDown('a')).toBe(false);
		});

		test('justPressed true only on press frame', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchKeyDown(target, 'a');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.justPressed('a')).toBe(true);

			ecs.update(0.016);
			expect(input.keyboard.justPressed('a')).toBe(false);
		});

		test('justReleased true only on release frame', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchKeyDown(target, 'a');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.justReleased('a')).toBe(false);

			dispatchKeyUp(target, 'a');
			ecs.update(0.016);

			expect(input.keyboard.justReleased('a')).toBe(true);

			ecs.update(0.016);
			expect(input.keyboard.justReleased('a')).toBe(false);
		});

		test('multiple simultaneous keys', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchKeyDown(target, 'a');
			dispatchKeyDown(target, 'b');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.isDown('a')).toBe(true);
			expect(input.keyboard.isDown('b')).toBe(true);
			expect(input.keyboard.justPressed('a')).toBe(true);
			expect(input.keyboard.justPressed('b')).toBe(true);
		});

		test('ignores key repeat events', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchKeyDown(target, 'a');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.justPressed('a')).toBe(true);

			dispatchKeyDown(target, 'a', true);
			dispatchKeyDown(target, 'a', true);
			ecs.update(0.016);

			expect(input.keyboard.justPressed('a')).toBe(false);
			expect(input.keyboard.isDown('a')).toBe(true);
		});
	});

	describe('Pointer', () => {
		test('tracks position from pointermove', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchPointerMove(target, 100, 200);
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.pointer.position.x).toBe(100);
			expect(input.pointer.position.y).toBe(200);
		});

		test('tracks delta between frames, resets each frame', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchPointerMove(target, 50, 50);
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.pointer.delta.x).toBe(50);
			expect(input.pointer.delta.y).toBe(50);

			dispatchPointerMove(target, 80, 60);
			ecs.update(0.016);

			expect(input.pointer.delta.x).toBe(30);
			expect(input.pointer.delta.y).toBe(10);

			ecs.update(0.016);
			expect(input.pointer.delta.x).toBe(0);
			expect(input.pointer.delta.y).toBe(0);
		});

		test('button isDown/justPressed/justReleased', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchPointerDown(target, 0);
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.pointer.isDown(0)).toBe(true);
			expect(input.pointer.justPressed(0)).toBe(true);

			ecs.update(0.016);
			expect(input.pointer.isDown(0)).toBe(true);
			expect(input.pointer.justPressed(0)).toBe(false);

			dispatchPointerUp(target, 0);
			ecs.update(0.016);
			expect(input.pointer.isDown(0)).toBe(false);
			expect(input.pointer.justReleased(0)).toBe(true);

			ecs.update(0.016);
			expect(input.pointer.justReleased(0)).toBe(false);
		});

		test('multiple buttons', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchPointerDown(target, 0);
			dispatchPointerDown(target, 2);
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.pointer.isDown(0)).toBe(true);
			expect(input.pointer.isDown(2)).toBe(true);
			expect(input.pointer.justPressed(0)).toBe(true);
			expect(input.pointer.justPressed(2)).toBe(true);

			dispatchPointerUp(target, 0);
			ecs.update(0.016);
			expect(input.pointer.isDown(0)).toBe(false);
			expect(input.pointer.isDown(2)).toBe(true);
			expect(input.pointer.justReleased(0)).toBe(true);
			expect(input.pointer.justReleased(2)).toBe(false);
		});
	});

	describe('Gamepad', () => {
		test('disconnected pads are safe to read', async () => {
			const { ecs } = createWorld({ pads: [null, null, null, null] });
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			expect(input.gamepads.length).toBe(4);
			for (const pad of input.gamepads) {
				expect(pad.connected).toBe(false);
				expect(pad.id).toBe(null);
				expect(pad.isDown(0)).toBe(false);
				expect(pad.axis(0)).toBe(0);
			}
		});

		test('reports connected pad id', async () => {
			const pad = mockPad('Xbox Controller');
			const { ecs } = createWorld({ pads: [pad, null, null, null] });
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			const g = input.gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;
			expect(g.connected).toBe(true);
			expect(g.id).toBe('Xbox Controller');
		});

		test('button isDown / justPressed / justReleased', async () => {
			const pad = mockPad();
			const { ecs } = createWorld({ pads: [pad, null, null, null] });
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			const g = input.gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;

			expect(g.isDown(0)).toBe(false);

			pressButton(pad, 0);
			ecs.update(0.016);
			expect(g.isDown(0)).toBe(true);
			expect(g.justPressed(0)).toBe(true);

			ecs.update(0.016);
			expect(g.isDown(0)).toBe(true);
			expect(g.justPressed(0)).toBe(false);

			releaseButton(pad, 0);
			ecs.update(0.016);
			expect(g.isDown(0)).toBe(false);
			expect(g.justReleased(0)).toBe(true);

			ecs.update(0.016);
			expect(g.justReleased(0)).toBe(false);
		});

		test('analog button value exposed via buttonValue()', async () => {
			const pad = mockPad();
			const { ecs } = createWorld({ pads: [pad, null, null, null] });
			await initAndUpdate(ecs);

			pad.buttons[7] = { pressed: true, value: 0.73 };
			ecs.update(0.016);

			const g = ecs.getResource('inputState').gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;
			expect(g.buttonValue(7)).toBeCloseTo(0.73);
		});

		test('disconnection emits justReleased for held buttons then clears', async () => {
			const pad = mockPad();
			pressButton(pad, 1);
			const { ecs } = createWorld({ pads: [pad, null, null, null] });
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			const g = input.gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;
			expect(g.isDown(1)).toBe(true);

			pad.connected = false;
			ecs.update(0.016);

			expect(g.connected).toBe(false);
			expect(g.id).toBe(null);
			expect(g.isDown(1)).toBe(false);
			expect(g.justReleased(1)).toBe(true);
		});

		test('radial deadzone: tiny stick input within deadzone reads as zero', async () => {
			const pad = mockPad();
			pad.axes[0] = 0.1;
			pad.axes[1] = 0.05;
			const { ecs } = createWorld({ pads: [pad, null, null, null], deadzone: 0.15 });
			await initAndUpdate(ecs);

			const g = ecs.getResource('inputState').gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;
			expect(g.axis(0)).toBe(0);
			expect(g.axis(1)).toBe(0);
			// Raw axes preserve original values
			expect(g.rawAxis(0)).toBeCloseTo(0.1);
			expect(g.rawAxis(1)).toBeCloseTo(0.05);
		});

		test('radial deadzone: full-tilt stick reports ~1 magnitude', async () => {
			const pad = mockPad();
			pad.axes[0] = 1;
			pad.axes[1] = 0;
			const { ecs } = createWorld({ pads: [pad, null, null, null], deadzone: 0.15 });
			await initAndUpdate(ecs);

			const g = ecs.getResource('inputState').gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;
			expect(g.axis(0)).toBeCloseTo(1, 5);
			expect(g.axis(1)).toBeCloseTo(0, 5);
		});

		test('radial deadzone applies to left and right stick independently', async () => {
			const pad = mockPad();
			pad.axes = [0.1, 0, 1, 0];
			const { ecs } = createWorld({ pads: [pad, null, null, null], deadzone: 0.15 });
			await initAndUpdate(ecs);

			const g = ecs.getResource('inputState').gamepads[0];
			expect(g).toBeDefined();
			if (!g) return;
			// Left stick below deadzone
			expect(g.axis(0)).toBe(0);
			// Right stick full
			expect(g.axis(2)).toBeCloseTo(1, 5);
		});
	});

	describe('Action mapping', () => {
		test('isActive when bound key is down', async () => {
			const { ecs, target } = createWorld({
				actions: { jump: { keys: [' '] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			expect(input.actions.isActive('jump')).toBe(false);

			dispatchKeyDown(target, ' ');
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(true);

			dispatchKeyUp(target, ' ');
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(false);
		});

		test('isActive when bound pointer button is down', async () => {
			const { ecs, target } = createWorld({
				actions: { shoot: { pointerButtons: [0] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			dispatchPointerDown(target, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(true);

			dispatchPointerUp(target, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(false);
		});

		test('isActive when bound gamepad button is down', async () => {
			const pad = mockPad();
			const { ecs } = createWorld({
				pads: [pad, null, null, null],
				actions: { jump: { gamepadButtons: gamepadButtonsOn(0, 0) } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			expect(input.actions.isActive('jump')).toBe(false);

			pressButton(pad, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(true);
			expect(input.actions.justActivated('jump')).toBe(true);

			releaseButton(pad, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(false);
			expect(input.actions.justDeactivated('jump')).toBe(true);
		});

		test('isActive when bound gamepad axis crosses threshold', async () => {
			const pad = mockPad();
			const { ecs } = createWorld({
				pads: [pad, null, null, null],
				actions: {
					moveRight: { gamepadAxes: [gamepadAxisOn(0, 0, 1, 0.3)] },
					moveLeft: { gamepadAxes: [gamepadAxisOn(0, 0, -1, 0.3)] },
				},
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			pad.axes[0] = 0.5;
			ecs.update(0.016);
			expect(input.actions.isActive('moveRight')).toBe(true);
			expect(input.actions.isActive('moveLeft')).toBe(false);

			pad.axes[0] = -0.5;
			ecs.update(0.016);
			expect(input.actions.isActive('moveRight')).toBe(false);
			expect(input.actions.isActive('moveLeft')).toBe(true);

			pad.axes[0] = 0.1;  // inside deadzone
			ecs.update(0.016);
			expect(input.actions.isActive('moveRight')).toBe(false);
			expect(input.actions.isActive('moveLeft')).toBe(false);
		});

		test('justActivated/justDeactivated edge detection', async () => {
			const { ecs, target } = createWorld({
				actions: { jump: { keys: [' '] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			dispatchKeyDown(target, ' ');
			ecs.update(0.016);
			expect(input.actions.justActivated('jump')).toBe(true);

			ecs.update(0.016);
			expect(input.actions.justActivated('jump')).toBe(false);
			expect(input.actions.isActive('jump')).toBe(true);

			dispatchKeyUp(target, ' ');
			ecs.update(0.016);
			expect(input.actions.justDeactivated('jump')).toBe(true);

			ecs.update(0.016);
			expect(input.actions.justDeactivated('jump')).toBe(false);
		});

		test('action bound to multiple keys (any activates)', async () => {
			const { ecs, target } = createWorld({
				actions: { jump: { keys: [' ', 'ArrowUp'] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			dispatchKeyDown(target, 'ArrowUp');
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(true);

			dispatchKeyUp(target, 'ArrowUp');
			dispatchKeyDown(target, ' ');
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(true);
		});

		test('action bound to keys, pointer buttons, and gamepad buttons (any activates)', async () => {
			const pad = mockPad();
			const { ecs, target } = createWorld({
				pads: [pad, null, null, null],
				actions: { shoot: { keys: ['z'], pointerButtons: [0], gamepadButtons: gamepadButtonsOn(0, 7) } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			dispatchKeyDown(target, 'z');
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(true);

			dispatchKeyUp(target, 'z');
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(false);

			dispatchPointerDown(target, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(true);

			dispatchPointerUp(target, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(false);

			pressButton(pad, 7);
			ecs.update(0.016);
			expect(input.actions.isActive('shoot')).toBe(true);
		});
	});

	describe('Per-player action maps', () => {
		test('registered at construction time via players option', async () => {
			const pad = mockPad();
			const { ecs, target } = createWorld({
				pads: [pad, null, null, null],
				players: {
					p1: { jump: { keys: [' '] } },
					p2: { jump: { gamepadButtons: gamepadButtonsOn(0, 0) } },
				},
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			expect(input.playerIds()).toEqual(['p1', 'p2']);

			const p1 = input.player('p1');
			const p2 = input.player('p2');
			expect(p1).toBeDefined();
			expect(p2).toBeDefined();
			if (!p1 || !p2) return;

			dispatchKeyDown(target, ' ');
			ecs.update(0.016);
			expect(p1.actions.isActive('jump')).toBe(true);
			expect(p2.actions.isActive('jump')).toBe(false);
			expect(p1.actions.justActivated('jump')).toBe(true);

			dispatchKeyUp(target, ' ');
			pressButton(pad, 0);
			ecs.update(0.016);
			expect(p1.actions.isActive('jump')).toBe(false);
			expect(p2.actions.isActive('jump')).toBe(true);
			expect(p1.actions.justDeactivated('jump')).toBe(true);
			expect(p2.actions.justActivated('jump')).toBe(true);
		});

		test('definePlayer adds a player at runtime', async () => {
			const pad = mockPad();
			const { ecs } = createWorld({ pads: [pad, null, null, null] });
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			expect(input.player('p1')).toBeUndefined();

			input.definePlayer('p1', { shoot: { gamepadButtons: gamepadButtonsOn(0, 1) } });
			expect(input.player('p1')).toBeDefined();
			expect(input.playerIds()).toContain('p1');

			pressButton(pad, 1);
			ecs.update(0.016);
			expect(input.player('p1')?.actions.isActive('shoot')).toBe(true);
		});

		test('removePlayer clears handle and state', async () => {
			const { ecs } = createWorld({
				players: { p1: { jump: { keys: [' '] } } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			expect(input.removePlayer('p1')).toBe(true);
			expect(input.player('p1')).toBeUndefined();
			expect(input.removePlayer('p1')).toBe(false);
			expect(input.playerIds()).not.toContain('p1');
		});

		test('per-player setActionMap replaces bindings', async () => {
			const { ecs, target } = createWorld({
				players: { p1: { jump: { keys: [' '] } } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			const p1 = input.player('p1');
			expect(p1).toBeDefined();
			if (!p1) return;

			p1.setActionMap({ jump: { keys: ['w'] } });

			dispatchKeyDown(target, 'w');
			ecs.update(0.016);
			expect(p1.actions.isActive('jump')).toBe(true);

			dispatchKeyUp(target, 'w');
			dispatchKeyDown(target, ' ');
			ecs.update(0.016);
			expect(p1.actions.isActive('jump')).toBe(false);
		});

		test('unified actions and per-player actions are independent', async () => {
			// Unified "pause" is any-source; per-player "jump" is scoped.
			const pad = mockPad();
			const { ecs, target } = createWorld({
				pads: [pad, null, null, null],
				actions: { pause: { keys: ['Escape'] } },
				players: {
					p1: { jump: { keys: [' '] } },
					p2: { jump: { gamepadButtons: gamepadButtonsOn(0, 0) } },
				},
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			dispatchKeyDown(target, 'Escape');
			ecs.update(0.016);
			expect(input.actions.isActive('pause')).toBe(true);
			expect(input.player('p1')?.actions.isActive('jump')).toBe(false);
			expect(input.player('p2')?.actions.isActive('jump')).toBe(false);

			dispatchKeyUp(target, 'Escape');
			pressButton(pad, 0);
			ecs.update(0.016);
			expect(input.actions.isActive('pause')).toBe(false);
			expect(input.player('p2')?.actions.isActive('jump')).toBe(true);
		});
	});

	describe('Action map mutation', () => {
		test('setActionMap applies new mappings', async () => {
			const { ecs, target } = createWorld({
				actions: { jump: { keys: [' '] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');

			input.setActionMap({ jump: { keys: ['w'] } });

			dispatchKeyDown(target, 'w');
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(true);

			dispatchKeyUp(target, 'w');
			dispatchKeyDown(target, ' ');
			ecs.update(0.016);
			expect(input.actions.isActive('jump')).toBe(false);
		});

		test('getActionMap returns current map', async () => {
			const { ecs } = createWorld({
				actions: { jump: { keys: [' '] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			const map = input.getActionMap();
			expect(map).toEqual({ jump: { keys: [' '] } });
		});
	});

	describe('Cleanup', () => {
		test('listeners removed on system removal', async () => {
			const target = new EventTarget();
			const ecs = ECSpresso
				.create()
				.withComponentTypes<TestComponents>()
				.withEventTypes<TestEvents>()
				.withResourceTypes<TestResources>()
				.withPlugin(createInputPlugin({ target }))
				.build();

			await ecs.initialize();
			ecs.update(0.016);

			ecs.removeSystem('input-state');

			dispatchKeyDown(target, 'a');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.isDown('a')).toBe(false);
		});
	});

	describe('Options', () => {
		test('default options work', async () => {
			const target = new EventTarget();
			const ecs = ECSpresso
				.create()
				.withComponentTypes<TestComponents>()
				.withEventTypes<TestEvents>()
				.withResourceTypes<TestResources>()
				.withPlugin(createInputPlugin({ target }))
				.build();

			await initAndUpdate(ecs);
			const input = ecs.getResource('inputState');
			expect(input).toBeDefined();
			expect(input.keyboard).toBeDefined();
			expect(input.pointer).toBeDefined();
			expect(input.actions).toBeDefined();
			expect(input.gamepads.length).toBe(4);
		});

		test('custom group/priority/phase', async () => {
			const target = new EventTarget();
			const ecs = ECSpresso
				.create()
				.withComponentTypes<TestComponents>()
				.withEventTypes<TestEvents>()
				.withResourceTypes<TestResources>()
				.withPlugin(createInputPlugin({
					target,
					systemGroup: 'custom-input',
					priority: 50,
					phase: 'update',
				}))
				.build();

			await initAndUpdate(ecs);
			const input = ecs.getResource('inputState');
			expect(input).toBeDefined();
		});

		test('initial action mappings', async () => {
			const { ecs, target } = createWorld({
				actions: { fire: { keys: ['f'] } },
			});
			await initAndUpdate(ecs);

			const input = ecs.getResource('inputState');
			dispatchKeyDown(target, 'f');
			ecs.update(0.016);
			expect(input.actions.isActive('fire')).toBe(true);
		});
	});

	describe('Edge cases', () => {
		test('key down+up in same frame (both justPressed and justReleased true)', async () => {
			const { ecs, target } = createWorld();
			await initAndUpdate(ecs);

			dispatchKeyDown(target, 'a');
			dispatchKeyUp(target, 'a');
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.keyboard.justPressed('a')).toBe(true);
			expect(input.keyboard.justReleased('a')).toBe(true);
			expect(input.keyboard.isDown('a')).toBe(false);
		});

		test('querying unmapped action returns false', async () => {
			const { ecs } = createWorld();
			await initAndUpdate(ecs);
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.actions.isActive('nonexistent')).toBe(false);
			expect(input.actions.justActivated('nonexistent')).toBe(false);
			expect(input.actions.justDeactivated('nonexistent')).toBe(false);
		});

		test('empty action bindings', async () => {
			const { ecs } = createWorld({
				actions: { empty: {} },
			});
			await initAndUpdate(ecs);
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			expect(input.actions.isActive('empty')).toBe(false);
		});
	});

	describe('Helper functions', () => {
		test('createActionBinding creates a binding', () => {
			const binding = createActionBinding({ keys: ['a', 'b'], pointerButtons: [0] });
			expect(binding.keys).toEqual(['a', 'b']);
			expect(binding.pointerButtons).toEqual([0]);
		});

		test('gamepadButtonsOn produces refs for one pad', () => {
			expect(gamepadButtonsOn(1, 0, 2, 9)).toEqual([
				{ pad: 1, button: 0 },
				{ pad: 1, button: 2 },
				{ pad: 1, button: 9 },
			]);
		});

		test('gamepadAxisOn produces an axis ref with default threshold omitted', () => {
			expect(gamepadAxisOn(0, 1, 1)).toEqual({ pad: 0, axis: 1, direction: 1 });
			expect(gamepadAxisOn(0, 1, -1, 0.3)).toEqual({ pad: 0, axis: 1, direction: -1, threshold: 0.3 });
		});
	});

	describe('Type-safe action names', () => {
		test('ActionState<A> constrains action parameter', () => {
			type Actions = 'jump' | 'shoot';
			const state: ActionState<Actions> = {
				isActive: (_action) => false,
				justActivated: (_action) => false,
				justDeactivated: (_action) => false,
			};
			state.isActive('jump');
			state.justActivated('shoot');
			// @ts-expect-error — 'fly' is not in 'jump' | 'shoot'
			state.isActive('fly');
			// @ts-expect-error — 'run' is not in 'jump' | 'shoot'
			state.justActivated('run');
			// @ts-expect-error — 'dash' is not in 'jump' | 'shoot'
			state.justDeactivated('dash');
			expect(true).toBe(true);
		});

		test('InputState<A> propagates A to actions', () => {
			type Actions = 'jump' | 'shoot';
			const _check = (_s: InputState<Actions>) => {
				_s.actions.isActive('jump');
				// @ts-expect-error — 'fly' is not in Actions
				_s.actions.isActive('fly');
			};
			void _check;
			expect(true).toBe(true);
		});

		test('InputResourceTypes<A> propagates A through to resource', () => {
			type Actions = 'jump' | 'shoot';
			type R = InputResourceTypes<Actions>;
			const _check = (_r: R) => {
				_r.inputState.actions.isActive('jump');
				// @ts-expect-error — 'fly' is not in Actions
				_r.inputState.actions.isActive('fly');
			};
			void _check;
			expect(true).toBe(true);
		});

		test('ActionMap<A> constrains keys', () => {
			type Actions = 'jump' | 'shoot';
			const _valid: ActionMap<Actions> = {
				jump: { keys: [' '] },
				shoot: { keys: ['z'] },
			};
			// @ts-expect-error — missing 'shoot'
			const _missing: ActionMap<Actions> = {
				jump: { keys: [' '] },
			};
			void _valid;
			void _missing;
			expect(true).toBe(true);
		});

		test('setActionMap requires all configured action names', () => {
			type Actions = 'jump' | 'shoot';
			const _check = (_s: InputState<Actions>) => {
				_s.setActionMap({
					jump: { keys: [' '] },
					shoot: { keys: ['z'] },
				});
				// @ts-expect-error — missing 'shoot'
				_s.setActionMap({
					jump: { keys: [' '] },
				});
			};
			void _check;
			expect(true).toBe(true);
		});

		test('getActionMap returns Readonly<ActionMap<A>>', () => {
			type Actions = 'jump' | 'shoot';
			const _check = (_s: InputState<Actions>) => {
				const map = _s.getActionMap();
				const _jumpBinding = map.jump;
				const _shootBinding = map.shoot;
				// @ts-expect-error — 'fly' is not in Actions
				const _invalid = map.fly;
				void _jumpBinding;
				void _shootBinding;
				void _invalid;
			};
			void _check;
			expect(true).toBe(true);
		});

		test('default (no config) accepts any string', () => {
			const _check = (_s: InputState) => {
				_s.actions.isActive('anything');
				_s.actions.justActivated('whatever');
			};
			void _check;
			expect(true).toBe(true);
		});

		test('InputResourceTypes (no param) works in extends clause', () => {
			interface MyResources extends InputResourceTypes {}
			const _check = (_r: MyResources) => {
				_r.inputState.actions.isActive('anything');
			};
			void _check;
			expect(true).toBe(true);
		});

		test('player(id) returns PlayerInput<A> typed by A', () => {
			type Actions = 'jump' | 'shoot';
			const _check = (_s: InputState<Actions>) => {
				const p = _s.player('p1');
				p?.actions.isActive('jump');
				// @ts-expect-error — 'fly' is not in Actions
				p?.actions.isActive('fly');
				p?.setActionMap({
					jump: { keys: [' '] },
					shoot: { keys: ['z'] },
				});
			};
			void _check;
			expect(true).toBe(true);
		});

		test('builder chain inference works end-to-end', async () => {
			const target = new EventTarget();
			const ecs = ECSpresso.create()
				.withPlugin(createInputPlugin({
					target,
					actions: {
						jump: { keys: [' '] },
						shoot: { keys: ['z'], pointerButtons: [0] },
					},
				}))
				.build();

			await ecs.initialize();
			ecs.update(0.016);

			const input = ecs.getResource('inputState');
			input.actions.isActive('jump');
			input.actions.justActivated('shoot');
			// @ts-expect-error — 'fly' is not a configured action
			input.actions.isActive('fly');

			expect(input.actions.isActive('jump')).toBe(false);
			expect(input.actions.isActive('shoot')).toBe(false);
		});
	});
});

test('reused input plugin isolates frame edges, maps, players, and listener cleanup', async () => {
	const target = new EventTarget();
	const plugin = createInputPlugin({
		target,
		actions: { jump: { keys: [' '] } },
		players: { p1: { jump: { keys: [' '] } } },
	});
	function buildWorld() {
		return ECSpresso.create().withPlugin(plugin).build();
	}
	const a = buildWorld();
	const b = buildWorld();
	await a.initialize();
	await b.initialize();
	const inputA = a.getResource('inputState');
	const inputB = b.getResource('inputState');
	inputA.setActionMap({ jump: { keys: ['x'] } });
	inputA.removePlayer('p1');
	expect(inputB.getActionMap()).toEqual({ jump: { keys: [' '] } });
	expect(inputB.playerIds()).toEqual(['p1']);
	dispatchKeyDown(target, ' ');
	dispatchPointerMove(target, 25, 50);
	a.update(0.016);
	expect(inputB.pointer.position).toEqual({ x: 0, y: 0 });
	b.update(0.016);
	expect(inputA.keyboard.justPressed(' ')).toBe(true);
	expect(inputB.keyboard.justPressed(' ')).toBe(true);
	expect(inputA.actions.isActive('jump')).toBe(false);
	expect(inputB.actions.justActivated('jump')).toBe(true);
	a.update(0.016);
	expect(inputB.keyboard.justPressed(' ')).toBe(true);
	await a.dispose();
	dispatchKeyUp(target, ' ');
	b.update(0.016);
	expect(inputB.keyboard.justReleased(' ')).toBe(true);
	const c = buildWorld();
	await c.initialize();
	expect(c.getResource('inputState').playerIds()).toEqual(['p1']);
	expect(c.getResource('inputState').keyboard.isDown(' ')).toBe(false);
	dispatchKeyDown(target, ' ');
	b.update(0.016);
	c.update(0.016);
	expect(inputB.actions.justActivated('jump')).toBe(true);
	expect(c.getResource('inputState').actions.justActivated('jump')).toBe(true);
	await b.dispose();
	await c.dispose();
});
