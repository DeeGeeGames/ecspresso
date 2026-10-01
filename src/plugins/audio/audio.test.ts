import { describe, test, expect, mock } from 'bun:test';
import ECSpresso from '../../ecspresso';
import type { WorldConfigFrom } from '../../type-utils';
import {
	defineAudioChannels,
	createAudioSource,
	createAudioPlugin,
	createAudioHelpers,
	loadSound,
	type AudioComponentTypes,
	type AudioEventTypes,
	type AudioResourceTypes,
	type AudioState,
	type PlayOptions,
	type ChannelsOf,
	type SoundEndedEvent,
} from './audio';

// ==================== Mock Setup ====================

interface MockHowlInstance {
	_src: string[];
	_volume: number;
	_loop: boolean;
	_html5: boolean;
	_nextSoundId: number;
	_onEndCallbacks: Map<number, Array<() => void>>;
	_playing: Map<number, boolean>;
	_paused: Map<number, boolean>;
	_volumeMap: Map<number, number>;
	_stopped: number[];

	volume(vol?: number, id?: number): number;
	loop(loop?: boolean): boolean;
	play(id?: number): number;
	stop(id?: number): void;
	pause(id?: number): void;
	once(event: string, cb: () => void, id?: number): void;

	_triggerEnd(soundId: number): void;
}

function createMockHowl(config?: {
	src?: string[];
	html5?: boolean;
	preload?: boolean;
	onload?: () => void;
	onloaderror?: (id: number, err: unknown) => void;
}): MockHowlInstance {
	const instance: MockHowlInstance = {
		_src: config?.src ?? [],
		_volume: 1,
		_loop: false,
		_html5: config?.html5 ?? false,
		_nextSoundId: 1,
		_onEndCallbacks: new Map(),
		_playing: new Map(),
		_paused: new Map(),
		_volumeMap: new Map(),
		_stopped: [],

		volume(vol?: number, id?: number): number {
			if (vol === undefined) return instance._volume;
			if (id !== undefined) {
				instance._volumeMap.set(id, vol);
			} else {
				instance._volume = vol;
			}
			return vol;
		},

		loop(loop?: boolean): boolean {
			if (loop === undefined) return instance._loop;
			instance._loop = loop;
			return loop;
		},

		play(id?: number): number {
			if (id !== undefined) {
				instance._playing.set(id, true);
				instance._paused.delete(id);
				return id;
			}
			const soundId = instance._nextSoundId++;
			instance._playing.set(soundId, true);
			return soundId;
		},

		stop(id?: number): void {
			if (id !== undefined) {
				instance._playing.delete(id);
				instance._paused.delete(id);
				instance._stopped.push(id);
			}
		},

		pause(id?: number): void {
			if (id !== undefined) {
				instance._playing.delete(id);
				instance._paused.set(id, true);
			}
		},

		once(event: string, cb: () => void, id?: number): void {
			if (event === 'end' && id !== undefined) {
				const existing = instance._onEndCallbacks.get(id) ?? [];
				existing.push(cb);
				instance._onEndCallbacks.set(id, existing);
			}
		},

		_triggerEnd(soundId: number): void {
			const callbacks = instance._onEndCallbacks.get(soundId) ?? [];
			instance._onEndCallbacks.delete(soundId);
			instance._playing.delete(soundId);
			for (const cb of callbacks) {
				cb();
			}
		},
	};

	return instance;
}

// Mock the howler module - onload fires asynchronously via queueMicrotask
mock.module('howler', () => ({
	Howl: class MockHowl {
		constructor(config: Record<string, unknown>) {
			const instance = createMockHowl(config as any);
			Object.assign(this, instance);
			// Fire onload asynchronously so `howl` variable is assigned first
			const onload = (config as Record<string, unknown>)['onload'] as (() => void) | undefined;
			if (onload) queueMicrotask(onload);
		}
	},
}));

// ==================== Test Helpers ====================

const testChannels = defineAudioChannels({
	sfx: { volume: 1 },
	music: { volume: 0.7 },
	ui: { volume: 0.8 },
});

type TestChannel = ChannelsOf<typeof testChannels>;

interface TestComponents extends AudioComponentTypes<TestChannel> {
	tag: string;
}

interface TestEvents extends AudioEventTypes<TestChannel> {}

interface TestResources extends AudioResourceTypes<TestChannel> {}

function createTestEcs(plugin = createAudioPlugin({ channels: testChannels })) {
	const explosionHowl = createMockHowl();
	const bgmHowl = createMockHowl();

	const ecs = ECSpresso
		.create<WorldConfigFrom<TestComponents, TestEvents, TestResources>>()
		.withPlugin(plugin)
		.withResource('$assets' as never, {
			get(key: string) {
				const map: Record<string, MockHowlInstance> = {
					explosion: explosionHowl,
					bgm: bgmHowl,
				};
				const result = map[key];
				if (!result) throw new Error(`Asset '${key}' not found`);
				return result;
			},
			isLoaded() { return true; },
			getStatus() { return 'loaded'; },
		} as never)
		.build();

	return { ecs, explosionHowl, bgmHowl };
}

// ==================== Type Tests ====================

describe('Audio Plugin Type Tests', () => {
	test('defineAudioChannels infers channel name union', () => {
		const channels = defineAudioChannels({
			sfx: { volume: 1 },
			music: { volume: 0.5 },
		});

		type Ch = ChannelsOf<typeof channels>;
		const _sfx: Ch = 'sfx';
		const _music: Ch = 'music';
		expect(_sfx).toBe('sfx');
		expect(_music).toBe('music');
	});

	test('ChannelsOf extracts names from defineAudioChannels result', () => {
		type Ch = ChannelsOf<typeof testChannels>;
		const valid: Ch[] = ['sfx', 'music', 'ui'];
		expect(valid).toHaveLength(3);
	});

	test('AudioState.setChannelVolume rejects invalid channel names', () => {
		// @ts-expect-error 'invalid' is not a valid channel
		const _opts: PlayOptions<TestChannel> = { channel: 'invalid' };
		expect(true).toBe(true);
	});

	test('PlayOptions.channel rejects invalid names', () => {
		// @ts-expect-error 'invalid' is not a valid channel
		const _opts: PlayOptions<TestChannel> = { channel: 'bad' };
		expect(true).toBe(true);
	});

	test('createAudioSource constrains channel param', () => {
		const source = createAudioSource<TestChannel>('explosion', 'sfx');
		expect(source.audioSource.channel).toBe('sfx');

		// @ts-expect-error 'invalid' is not a valid channel
		createAudioSource<TestChannel>('explosion', 'invalid');
	});

	test('unparameterized types default to string', () => {
		const _state: AudioState = {} as AudioState;
		_state.setChannelVolume?.('anything', 0.5);
		expect(true).toBe(true);
	});
});

// ==================== Unit Tests ====================

describe('defineAudioChannels', () => {
	test('returns frozen config', () => {
		const channels = defineAudioChannels({
			sfx: { volume: 1 },
			music: { volume: 0.5 },
		});

		expect(Object.isFrozen(channels)).toBe(true);
	});

	test('preserves volumes', () => {
		const channels = defineAudioChannels({
			sfx: { volume: 0.9 },
			music: { volume: 0.3 },
		});

		expect(channels.sfx.volume).toBe(0.9);
		expect(channels.music.volume).toBe(0.3);
	});
});

describe('createAudioSource', () => {
	test('returns correct shape with defaults', () => {
		const result = createAudioSource('explosion', 'sfx');
		expect(result.audioSource).toEqual({
			sound: 'explosion',
			channel: 'sfx',
			volume: 1,
			loop: false,
			autoRemove: false,
			playing: false,
			_soundId: -1,
		});
	});

	test('returns correct shape with custom options', () => {
		const result = createAudioSource('bgm', 'music', {
			volume: 0.5,
			loop: true,
			autoRemove: true,
		});
		expect(result.audioSource).toEqual({
			sound: 'bgm',
			channel: 'music',
			volume: 0.5,
			loop: true,
			autoRemove: true,
			playing: false,
			_soundId: -1,
		});
	});
});

describe('loadSound', () => {
	test('returns a function', () => {
		const loader = loadSound('/test.mp3');
		expect(typeof loader).toBe('function');
	});

	test('loader returns a Promise that resolves', async () => {
		const loader = loadSound('/test.mp3');
		const howl = await loader();
		expect(howl).toBeDefined();
	});

	test('loader resolves with array src', async () => {
		const loader = loadSound(['/test.webm', '/test.mp3']);
		const howl = await loader();
		expect(howl).toBeDefined();
	});
});

// ==================== Integration Tests ====================

describe('Audio Plugin Integration', () => {
	test('plugin registers audioState resource', async () => {
		const { ecs } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');
		expect(audio).toBeDefined();
		expect(typeof audio.play).toBe('function');
		expect(typeof audio.stop).toBe('function');
		expect(typeof audio.playMusic).toBe('function');
		expect(typeof audio.stopMusic).toBe('function');
	});

	test('audioState.play() creates sound and returns soundId', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');
		const soundId = audio.play('explosion', { channel: 'sfx' });
		expect(soundId).toBeGreaterThan(0);
		expect(explosionHowl._playing.has(soundId)).toBe(true);
	});

	test('channel volume: effective = individual * channel * master', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		// channel 'sfx' = 1.0 (from testChannels), individual = 0.5, master = 1.0
		// howl.volume(0.5) called before play (sets _volume on howl instance)
		audio.play('explosion', { channel: 'sfx', volume: 0.5 });
		expect(explosionHowl._volume).toBe(0.5);
	});

	test('master volume affects all channels', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		const soundId = audio.play('explosion', { channel: 'sfx', volume: 1 });
		audio.setMasterVolume(0.5);

		// Propagation calls howl.volume(0.5, soundId) -> _volumeMap
		expect(explosionHowl._volumeMap.get(soundId)).toBe(0.5);
	});

	test('setChannelVolume propagates to active sounds', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		const soundId = audio.play('explosion', { channel: 'sfx', volume: 1 });
		audio.setChannelVolume('sfx', 0.5);

		// individual=1, channel=0.5, master=1 -> 0.5
		expect(explosionHowl._volumeMap.get(soundId)).toBe(0.5);
	});

	test('mute/unmute toggles', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		const soundId = audio.play('explosion', { channel: 'sfx' });
		expect(audio.isMuted()).toBe(false);

		audio.mute();
		expect(audio.isMuted()).toBe(true);
		expect(explosionHowl._volumeMap.get(soundId)).toBe(0);

		audio.unmute();
		expect(audio.isMuted()).toBe(false);
		expect(explosionHowl._volumeMap.get(soundId)).toBe(1);
	});

	test('toggleMute works', async () => {
		const { ecs } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		expect(audio.isMuted()).toBe(false);
		audio.toggleMute();
		expect(audio.isMuted()).toBe(true);
		audio.toggleMute();
		expect(audio.isMuted()).toBe(false);
	});

	test('playMusic starts music and stores per-channel reference', async () => {
		const { ecs, bgmHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		audio.playMusic('bgm', { channel: 'music' });
		expect(bgmHowl._playing.size).toBeGreaterThan(0);
		expect(bgmHowl._loop).toBe(true);
	});

	test('playMusic replaces existing music on same channel', async () => {
		const { ecs, bgmHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		audio.playMusic('bgm', { channel: 'music' });
		const firstSoundId = Array.from(bgmHowl._playing.keys())[0]!;

		audio.playMusic('bgm', { channel: 'music' });
		expect(bgmHowl._stopped).toContain(firstSoundId);
	});

	test('stopMusic stops music on channel', async () => {
		const { ecs, bgmHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		audio.playMusic('bgm', { channel: 'music' });
		audio.stopMusic('music');
		expect(bgmHowl._stopped.length).toBeGreaterThan(0);
	});

	test('pauseMusic/resumeMusic work', async () => {
		const { ecs, bgmHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		audio.playMusic('bgm', { channel: 'music' });
		const soundId = Array.from(bgmHowl._playing.keys())[0]!;

		audio.pauseMusic('music');
		expect(bgmHowl._paused.has(soundId)).toBe(true);
		expect(bgmHowl._playing.has(soundId)).toBe(false);

		audio.resumeMusic('music');
		expect(bgmHowl._playing.has(soundId)).toBe(true);
	});

	test('getChannelVolume returns correct value', async () => {
		const { ecs } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		expect(audio.getChannelVolume('sfx')).toBe(1);
		expect(audio.getChannelVolume('music')).toBe(0.7);
		expect(audio.getChannelVolume('ui')).toBe(0.8);
	});

	test('getMasterVolume returns correct value', async () => {
		const { ecs } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		expect(audio.getMasterVolume()).toBe(1);
		audio.setMasterVolume(0.5);
		expect(audio.getMasterVolume()).toBe(0.5);
	});

	test('stop removes active sound', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();
		const audio = ecs.getResource('audioState');

		const soundId = audio.play('explosion', { channel: 'sfx' });
		audio.stop(soundId);
		expect(explosionHowl._stopped).toContain(soundId);
	});
});

// ==================== Component Lifecycle Tests ====================

describe('AudioSource Component', () => {
	test('sound starts on spawn after initialization', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		ecs.spawn({
			...createAudioSource<TestChannel>('explosion', 'sfx'),
		});

		// Reactive query triggers on next update
		ecs.update(0.016);

		expect(explosionHowl._playing.size).toBeGreaterThan(0);
	});

	test('sound stops on entity removal (dispose)', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		const entity = ecs.spawn({
			...createAudioSource<TestChannel>('explosion', 'sfx'),
		});

		ecs.update(0.016);
		const soundId = entity.components.audioSource._soundId;
		expect(soundId).not.toBe(-1);

		ecs.removeEntity(entity.id);
		ecs.update(0.016);

		expect(explosionHowl._stopped).toContain(soundId);
	});

	test('soundEnded event published on completion', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		const endedEvents: SoundEndedEvent[] = [];
		ecs.eventBus.subscribe('soundEnded', (data) => {
			endedEvents.push(data);
		});

		const entity = ecs.spawn({
			...createAudioSource<TestChannel>('explosion', 'sfx'),
		});

		ecs.update(0.016);
		const soundId = entity.components.audioSource._soundId;

		explosionHowl._triggerEnd(soundId);

		expect(endedEvents.length).toBe(1);
		expect(endedEvents[0]!.entityId).toBe(entity.id);
		expect(endedEvents[0]!.soundId).toBe(soundId);
		expect(endedEvents[0]!.sound).toBe('explosion');
	});

	test('autoRemove removes entity on completion', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		const entity = ecs.spawn({
			...createAudioSource<TestChannel>('explosion', 'sfx', { autoRemove: true }),
		});

		ecs.update(0.016);
		const soundId = entity.components.audioSource._soundId;

		explosionHowl._triggerEnd(soundId);

		// Command buffer flushes on next update
		ecs.update(0.016);

		expect(ecs.entityManager.getEntity(entity.id)).toBeUndefined();
	});

	test('audioSource volume respects channel volume', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		ecs.spawn({
			...createAudioSource<TestChannel>('explosion', 'sfx', { volume: 0.5 }),
		});

		ecs.update(0.016);

		// sfx channel = 1.0, individual = 0.5, master = 1.0
		// effective = 0.5
		expect(explosionHowl._volume).toBe(0.5);
	});
});

// ==================== Event Handler Tests ====================

describe('Audio Event Handlers', () => {
	test('playSound event triggers playback', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		ecs.eventBus.publish('playSound', {
			sound: 'explosion',
			channel: 'sfx' as TestChannel,
		});

		// Event handlers run during update
		ecs.update(0.016);

		expect(explosionHowl._playing.size).toBeGreaterThan(0);
	});

	test('stopMusic event triggers stop', async () => {
		const { ecs, bgmHowl } = createTestEcs();
		await ecs.initialize();

		const audio = ecs.getResource('audioState');
		audio.playMusic('bgm', { channel: 'music' });

		ecs.eventBus.publish('stopMusic', {
			channel: 'music' as TestChannel,
		});

		ecs.update(0.016);

		expect(bgmHowl._stopped.length).toBeGreaterThan(0);
	});

	test('soundEnded event fires for fire-and-forget sounds', async () => {
		const { ecs, explosionHowl } = createTestEcs();
		await ecs.initialize();

		const endedEvents: SoundEndedEvent[] = [];
		ecs.eventBus.subscribe('soundEnded', (data) => {
			endedEvents.push(data);
		});

		const audio = ecs.getResource('audioState');
		const soundId = audio.play('explosion', { channel: 'sfx' });

		explosionHowl._triggerEnd(soundId);

		expect(endedEvents.length).toBe(1);
		expect(endedEvents[0]!.entityId).toBe(-1);
		expect(endedEvents[0]!.soundId).toBe(soundId);
	});
});

// ==================== Helpers Tests ====================

describe('Audio Helpers', () => {
	test('createAudioHelpers returns createAudioSource', () => {
		const helpers = createAudioHelpers();
		expect(typeof helpers.createAudioSource).toBe('function');
	});

	test('helpers createAudioSource produces valid component', () => {
		const helpers = createAudioHelpers();
		const source = helpers.createAudioSource('boom', 'sfx');
		expect(source.audioSource.sound).toBe('boom');
		expect(source.audioSource.channel).toBe('sfx');
	});
});

test('reused audio plugin isolates assets, controls, events, and teardown', async () => {
	const plugin = createAudioPlugin({ channels: testChannels });
	const a = createTestEcs(plugin);
	const b = createTestEcs(plugin);
	await a.ecs.initialize();
	await b.ecs.initialize();
	const audioA = a.ecs.getResource('audioState');
	const audioB = b.ecs.getResource('audioState');
	const endedA: SoundEndedEvent[] = [];
	const endedB: SoundEndedEvent[] = [];
	a.ecs.eventBus.subscribe('soundEnded', (event) => endedA.push(event));
	b.ecs.eventBus.subscribe('soundEnded', (event) => endedB.push(event));
	audioA.setChannelVolume('sfx', 0.2);
	audioA.setMasterVolume(0.5);
	audioA.mute();
	expect(audioB.getChannelVolume('sfx')).toBe(1);
	expect(audioB.getMasterVolume()).toBe(1);
	expect(audioB.isMuted()).toBe(false);
	const soundA = audioA.play('explosion');
	const soundB = audioB.play('explosion');
	expect(a.explosionHowl._playing.has(soundA)).toBe(true);
	expect(b.explosionHowl._playing.has(soundB)).toBe(true);
	a.explosionHowl._triggerEnd(soundA);
	expect(endedA).toHaveLength(1);
	expect(endedB).toHaveLength(0);
	audioA.play('explosion');
	await a.ecs.dispose();
	expect(b.explosionHowl._playing.has(soundB)).toBe(true);
	b.explosionHowl._triggerEnd(soundB);
	expect(endedB).toHaveLength(1);
	await b.ecs.dispose();
});
