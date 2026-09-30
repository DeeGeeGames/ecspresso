/**
 * Audio Plugin Example
 *
 * Demonstrates:
 * - User-defined audio channels (sfx, music) with type-safe names
 * - Fire-and-forget sound effects via audioState resource
 * - Music playback with play/pause/resume/stop
 * - Volume hierarchy: individual * channel * master
 * - Mute/unmute toggling
 * - Entity-attached sounds via audioSource component (with autoRemove)
 * - Event-driven playback (playSound, stopMusic, soundEnded)
 */

import ECSpresso, { type WorldConfigFrom } from 'ecspresso';
import { requireElement } from '../utils';
import {
	defineAudioChannels,
	createAudioPlugin,
	createAudioSource,
	loadSound,
	type ChannelsOf,
	type AudioComponentTypes,
	type AudioEventTypes,
	type AudioResourceTypes,
	type SoundEndedEvent,
} from 'ecspresso/plugins/audio/audio';

// ==================== Channel Definition ====================

const channels = defineAudioChannels({
	sfx: { volume: 1 },
	music: { volume: 0.7 },
});

type Ch = ChannelsOf<typeof channels>;

// ==================== ECS Setup ====================

interface Components extends AudioComponentTypes<Ch> {
	tag: string;
}

interface Events extends AudioEventTypes<Ch> {}

interface Resources extends AudioResourceTypes<Ch> {}

const ecs = ECSpresso
	.create<WorldConfigFrom<Components, Events, Resources>>()
	.withAssets(a => a
		.add('click', loadSound(new URL('./assets/click.wav', document.baseURI).href))
		.add('coin', loadSound(new URL('./assets/coin.wav', document.baseURI).href))
		.add('explosion', loadSound(new URL('./assets/explosion.wav', document.baseURI).href))
		.add('bgm', loadSound(new URL('./assets/bgm.wav', document.baseURI).href))
	)
	.withPlugin(createAudioPlugin({ channels }))
	.build();

await ecs.initialize();

const audio = ecs.getResource('audioState');

// ==================== Logging ====================

const logEl = requireElement('log', HTMLElement);

function log(message: string, category: 'sfx' | 'music' | 'event' | 'volume' = 'event') {
	const entry = document.createElement('div');
	entry.className = `entry ${category}`;
	const time = new Date().toLocaleTimeString('en-US', { hour12: false });
	entry.textContent = `[${time}] ${message}`;
	logEl.prepend(entry);

	// Keep log manageable
	while (logEl.children.length > 50) {
		logEl.lastElementChild?.remove();
	}
}

// ==================== Sound Effects ====================

function bindButton(id: string, handler: () => void) {
	document.getElementById(id)?.addEventListener('click', handler);
}

bindButton('btn-click', () => {
	const soundId = audio.play('click', { channel: 'sfx' });
	log(`Played click (soundId: ${soundId})`, 'sfx');
});

bindButton('btn-coin', () => {
	const soundId = audio.play('coin', { channel: 'sfx' });
	log(`Played coin (soundId: ${soundId})`, 'sfx');
});

bindButton('btn-explosion', () => {
	const soundId = audio.play('explosion', { channel: 'sfx' });
	log(`Played explosion (soundId: ${soundId})`, 'sfx');
});

// ==================== Entity-Attached Sound ====================

bindButton('btn-entity-sound', () => {
	const entity = ecs.spawn({
		...createAudioSource<Ch>('coin', 'sfx', { autoRemove: true }),
		tag: 'entity-sound',
	});
	log(`Spawned entity ${entity.id} with audioSource (autoRemove)`, 'sfx');
	// Trigger reactive query processing
	ecs.update(0);
});

// Listen for soundEnded events
ecs.eventBus.subscribe('soundEnded', (data: SoundEndedEvent) => {
	const source = data.entityId === -1 ? 'fire-and-forget' : `entity ${data.entityId}`;
	log(`Sound ended: ${data.sound} (${source}, soundId: ${data.soundId})`, 'event');
});

// ==================== Music ====================

bindButton('btn-play-music', () => {
	audio.playMusic('bgm', { channel: 'music' });
	log('Playing music on music channel', 'music');
});

bindButton('btn-pause-music', () => {
	audio.pauseMusic('music');
	log('Paused music', 'music');
});

bindButton('btn-resume-music', () => {
	audio.resumeMusic('music');
	log('Resumed music', 'music');
});

bindButton('btn-stop-music', () => {
	audio.stopMusic('music');
	log('Stopped music', 'music');
});

// ==================== Volume Controls ====================

function bindSlider(sliderId: string, valueId: string, handler: (value: number) => void) {
	const slider = requireElement(sliderId, HTMLInputElement);
	const valueEl = requireElement(valueId, HTMLElement);
	slider.addEventListener('input', () => {
		const value = parseInt(slider.value, 10);
		valueEl.textContent = String(value);
		handler(value / 100);
	});
}

bindSlider('vol-master', 'val-master', (vol) => {
	audio.setMasterVolume(vol);
	log(`Master volume: ${Math.round(vol * 100)}%`, 'volume');
});

bindSlider('vol-sfx', 'val-sfx', (vol) => {
	audio.setChannelVolume('sfx', vol);
	log(`SFX channel volume: ${Math.round(vol * 100)}%`, 'volume');
});

bindSlider('vol-music', 'val-music', (vol) => {
	audio.setChannelVolume('music', vol);
	log(`Music channel volume: ${Math.round(vol * 100)}%`, 'volume');
});

// Mute toggle
const muteBtn = requireElement('btn-mute', HTMLButtonElement);
muteBtn.addEventListener('click', () => {
	audio.toggleMute();
	const muted = audio.isMuted();
	muteBtn.textContent = muted ? 'Unmute All' : 'Mute All';
	muteBtn.classList.toggle('active', muted);
	log(muted ? 'Muted all audio' : 'Unmuted all audio', 'volume');
});

// ==================== Ready ====================

log('Audio plugin initialized. Click buttons to play sounds.');

const timing = { previousUpdateTime: performance.now() };
const updateIntervalId = window.setInterval(() => {
	const time = performance.now();
	ecs.update((time - timing.previousUpdateTime) / 1_000);
	timing.previousUpdateTime = time;
}, 1000 / 60);

window.addEventListener('pagehide', () => {
	window.clearInterval(updateIntervalId);
	void ecs.dispose();
}, { once: true });
