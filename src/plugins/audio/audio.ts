/**
 * Audio Plugin for ECSpresso
 *
 * Web Audio API integration via Howler.js for sound effects and music playback.
 * User-defined channels with type-safe volume control, hybrid resource + component API,
 * and asset manager integration.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { AssetsOfWorld, AnyECSpresso, ChannelOfWorld } from 'ecspresso';
import type { Howl } from 'howler';

// ==================== Channel Definition ====================

/**
 * Configuration for a single audio channel.
 */
export interface AudioChannelConfig {
	readonly volume: number;
}

/**
 * Define audio channels with type-safe names and initial volumes.
 * Mirrors `defineCollisionLayers` pattern.
 *
 * @param channels Object mapping channel names to their configuration
 * @returns Frozen channel configuration with inferred channel name union
 *
 * @example
 * ```typescript
 * const channels = defineAudioChannels({
 *   sfx: { volume: 1 },
 *   music: { volume: 0.7 },
 *   ui: { volume: 0.8 },
 * });
 * type Ch = ChannelsOf<typeof channels>; // 'sfx' | 'music' | 'ui'
 * ```
 */
export function defineAudioChannels<const T extends Record<string, AudioChannelConfig>>(
	channels: T
): Readonly<T> {
	return Object.freeze(channels);
}

/**
 * Extract channel name union from a `defineAudioChannels` result.
 */
export type ChannelsOf<T> = T extends Record<infer K extends string, AudioChannelConfig> ? K : never;

// ==================== Component Types ====================

/**
 * Audio source component attached to entities for positional/entity-bound audio.
 */
export interface AudioSource<Ch extends string = string> {
	/** Asset key for the sound */
	readonly sound: string;
	/** Channel this sound plays on */
	readonly channel: Ch;
	/** Individual volume (0-1) */
	volume: number;
	/** Whether sound loops */
	loop: boolean;
	/** Remove entity when sound ends (like timer autoRemove) */
	autoRemove: boolean;
	/** Whether sound is currently playing (system-managed) */
	playing: boolean;
	/** Howler sound ID (system-managed, -1 = not started) */
	_soundId: number;
}

/**
 * Component types provided by the audio plugin.
 */
export interface AudioComponentTypes<Ch extends string = string> {
	audioSource: AudioSource<Ch>;
}

// ==================== Event Types ====================

/**
 * Event to trigger fire-and-forget sound playback from any system.
 */
export interface PlaySoundEvent<Ch extends string = string> {
	/** Asset key for the sound */
	sound: string;
	/** Channel to play on */
	channel?: Ch;
	/** Individual volume (0-1) */
	volume?: number;
	/** Whether sound loops */
	loop?: boolean;
}

/**
 * Event to stop music on a channel.
 */
export interface StopMusicEvent<Ch extends string = string> {
	/** Channel to stop music on. If omitted, stops all music. */
	channel?: Ch;
}

/**
 * Event published when a sound finishes playing.
 */
export interface SoundEndedEvent {
	/** Entity ID if sound was entity-attached, -1 for fire-and-forget */
	entityId: number;
	/** Howler sound ID */
	soundId: number;
	/** Asset key of the sound */
	sound: string;
}

/**
 * Event types provided by the audio plugin.
 */
export interface AudioEventTypes<Ch extends string = string> {
	playSound: PlaySoundEvent<Ch>;
	stopMusic: StopMusicEvent<Ch>;
	soundEnded: SoundEndedEvent;
}

// ==================== Resource Types ====================

/**
 * Play options for fire-and-forget sound effects.
 */
export interface PlayOptions<Ch extends string = string> {
	/** Channel to play on (uses first defined channel if omitted) */
	channel?: Ch;
	/** Individual volume (0-1, default: 1) */
	volume?: number;
	/** Whether to loop (default: false) */
	loop?: boolean;
}

/**
 * Music playback options.
 */
export interface MusicOptions<Ch extends string = string> {
	/** Channel to play music on (uses first defined channel if omitted) */
	channel?: Ch;
	/** Volume (0-1, default: 1) */
	volume?: number;
	/** Whether to loop (default: true) */
	loop?: boolean;
}

/**
 * Audio state resource providing fire-and-forget SFX and music control.
 * Effective volume = individual * channel * master.
 */
export interface AudioState<Ch extends string = string> {
	/** Play a fire-and-forget sound effect. Returns the Howler sound ID. */
	play(sound: string, options?: PlayOptions<Ch>): number;
	/** Stop a specific sound by its Howler sound ID. */
	stop(soundId: number): void;

	/** Play music on a channel. Stops any existing music on that channel first. */
	playMusic(sound: string, options?: MusicOptions<Ch>): void;
	/** Stop music on a channel. If omitted, stops all music. */
	stopMusic(channel?: Ch): void;
	/** Pause music on a channel. If omitted, pauses all music. */
	pauseMusic(channel?: Ch): void;
	/** Resume music on a channel. If omitted, resumes all music. */
	resumeMusic(channel?: Ch): void;

	/** Set volume for a channel (0-1). */
	setChannelVolume(channel: Ch, volume: number): void;
	/** Get current volume for a channel. */
	getChannelVolume(channel: Ch): number;
	/** Set master volume (0-1). */
	setMasterVolume(volume: number): void;
	/** Get current master volume. */
	getMasterVolume(): number;
	/** Mute all audio. */
	mute(): void;
	/** Unmute all audio. */
	unmute(): void;
	/** Toggle mute state. */
	toggleMute(): void;
	/** Check if audio is muted. */
	isMuted(): boolean;
}

/**
 * Resource types provided by the audio plugin.
 */
export interface AudioResourceTypes<Ch extends string = string> {
	audioState: AudioState<Ch>;
}

// ==================== Plugin Options ====================

/**
 * Configuration options for the audio plugin.
 */
export interface AudioPluginOptions<Ch extends string, G extends string = 'audio'> extends BasePluginOptions<G> {
	/** Channel definitions from defineAudioChannels */
	channels: Readonly<Record<Ch, AudioChannelConfig>>;
}

// ==================== Helper Functions ====================

/**
 * Create an audioSource component for entity-attached audio.
 *
 * @param sound Asset key for the sound
 * @param channel Channel to play on
 * @param options Optional configuration
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createAudioSource('explosion', 'sfx'),
 *   ...createTransform(100, 200),
 * });
 * ```
 */
export function createAudioSource<Ch extends string>(
	sound: string,
	channel: Ch,
	options?: { volume?: number; loop?: boolean; autoRemove?: boolean }
): Pick<AudioComponentTypes<Ch>, 'audioSource'> {
	return {
		audioSource: {
			sound,
			channel,
			volume: options?.volume ?? 1,
			loop: options?.loop ?? false,
			autoRemove: options?.autoRemove ?? false,
			playing: false,
			_soundId: -1,
		},
	};
}

/**
 * Create a loader function for use with the asset manager.
 * Returns a factory function that loads a Howl when called.
 *
 * @param src URL(s) for the sound file
 * @param options Optional Howl configuration
 * @returns Factory function compatible with asset manager's loader parameter
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withAssets(a => a
 *     .add('explosion', loadSound('/sounds/explosion.mp3'))
 *     .add('bgm', loadSound(['/sounds/bgm.webm', '/sounds/bgm.mp3']))
 *   )
 *   .build();
 * ```
 */
export function loadSound(
	src: string | string[],
	options?: { html5?: boolean; preload?: boolean }
): () => Promise<Howl> {
	return () => import('howler').then(({ Howl: HowlClass }) =>
		new Promise<Howl>((resolve, reject) => {
			let howl: Howl;
			let resolved = false;
			howl = new HowlClass({
				src: Array.isArray(src) ? src : [src],
				html5: options?.html5 ?? false,
				preload: options?.preload ?? true,
				onload: () => {
					resolved = true;
					resolve(howl);
				},
				onloaderror: (_id: number, err: unknown) => reject(
					err instanceof Error ? err : new Error(String(err))
				),
			});
			// If onload fired synchronously during construction (e.g. cached),
			// howl is now assigned and the promise is already resolved.
			if (!resolved && howl.state?.() === 'loaded') {
				resolve(howl);
			}
		})
	);
}

// ==================== Internal Types ====================

interface ActiveSound<Ch extends string> {
	howl: Howl;
	soundId: number;
	channel: Ch;
	individualVolume: number;
	assetKey: string;
	entityId: number;
}

interface MusicEntry<Ch extends string> {
	howl: Howl;
	soundId: number;
	channel: Ch;
	individualVolume: number;
	assetKey: string;
}

// ==================== Plugin Factory ====================

/**
 * Create an audio plugin for ECSpresso.
 *
 * Provides:
 * - `audioState` resource for fire-and-forget SFX and music
 * - `audioSource` component for entity-attached sounds
 * - Volume hierarchy: individual * channel * master
 * - `playSound` / `stopMusic` event handlers
 * - `soundEnded` event on completion
 * - Automatic cleanup on entity removal (dispose callback)
 *
 * Sounds must be preloaded through the asset pipeline (`loadSound` helper).
 *
 * @example
 * ```typescript
 * const channels = defineAudioChannels({
 *   sfx: { volume: 1 },
 *   music: { volume: 0.7 },
 * });
 *
 * const ecs = ECSpresso.create()
 *   .withAssets(a => a.add('explosion', loadSound('/sfx/boom.mp3')))
 *   .withPlugin(createAudioPlugin({ channels }))
 *   .build();
 *
 * await ecs.initialize();
 * const audio = ecs.getResource('audioState');
 * audio.play('explosion', { channel: 'sfx' });
 * ```
 */
export function createAudioPlugin<Ch extends string, G extends string = 'audio'>(
	options: AudioPluginOptions<Ch, G>
) {
	const {
		channels: channelDefs,
		systemGroup = 'audio',
		priority = 0,
		phase = 'update',
	} = options;

	return definePlugin('audio')
		.withComponentTypes<AudioComponentTypes<Ch>>()
		.withEventTypes<AudioEventTypes<Ch>>()
		.withResourceTypes<AudioResourceTypes<Ch>>()
		.withLabels<'audio-sync'>()
		.withGroups<G>()
		.withReactiveQueryNames<'audio-sources'>()
		.install((world) => {
			// Closure state
			const channelVolumes = new Map<Ch, number>();
			const activeSounds = new Map<number, ActiveSound<Ch>>();
			const musicByChannel = new Map<Ch, MusicEntry<Ch>>();
			let masterVolume = 1;
			let muted = false;

			// Initialize channel volumes from definitions
			const channelNames: Ch[] = [];
			for (const [name, config] of Object.entries(channelDefs) as Array<[Ch, AudioChannelConfig]>) {
				channelVolumes.set(name, config.volume);
				channelNames.push(name);
			}

			const defaultChannel = channelNames[0] as Ch;

			// Volume computation
			function effectiveVolume(individualVol: number, channel: Ch): number {
				if (muted) return 0;
				const chanVol = channelVolumes.get(channel) ?? 1;
				return individualVol * chanVol * masterVolume;
			}

			// Propagate volume changes to all active sounds on a channel
			function propagateChannelVolume(channel: Ch): void {
				for (const sound of activeSounds.values()) {
					if (sound.channel !== channel) continue;
					sound.howl.volume(effectiveVolume(sound.individualVolume, channel), sound.soundId);
				}
				const music = musicByChannel.get(channel);
				if (music) {
					music.howl.volume(effectiveVolume(music.individualVolume, channel), music.soundId);
				}
			}

			// Propagate volume to all sounds across all channels
			function propagateAllVolumes(): void {
				for (const ch of channelNames) {
					propagateChannelVolume(ch);
				}
			}

			// Stop a sound by its Howler sound ID
			function stopSoundById(soundId: number): void {
				const entry = activeSounds.get(soundId);
				if (!entry) return;
				entry.howl.stop(soundId);
				activeSounds.delete(soundId);
			}

			// Event bus reference, set during initialization
			let eventBusRef: { publish(event: string, data: unknown): void } | null = null;

			// Resolve Howl from asset key
			let getAsset: ((key: string) => Howl) | null = null;

			// AudioState resource implementation
			const audioState: AudioState<Ch> = {
				play(sound, playOpts) {
					if (!getAsset) return -1;
					const channel = playOpts?.channel ?? defaultChannel;
					const individualVol = playOpts?.volume ?? 1;
					const loop = playOpts?.loop ?? false;

					const howl = getAsset(sound);
					howl.volume(effectiveVolume(individualVol, channel));
					howl.loop(loop);
					const soundId = howl.play();

					const entry: ActiveSound<Ch> = {
						howl,
						soundId,
						channel,
						individualVolume: individualVol,
						assetKey: sound,
						entityId: -1,
					};
					activeSounds.set(soundId, entry);

					howl.once('end', () => {
						activeSounds.delete(soundId);
						eventBusRef?.publish('soundEnded', {
							entityId: -1,
							soundId,
							sound,
						} satisfies SoundEndedEvent);
					}, soundId);

					return soundId;
				},

				stop(soundId) {
					stopSoundById(soundId);
				},

				playMusic(sound, musicOpts) {
					if (!getAsset) return;
					const channel = musicOpts?.channel ?? defaultChannel;
					const individualVol = musicOpts?.volume ?? 1;
					const loop = musicOpts?.loop ?? true;

					// Stop existing music on this channel
					const existing = musicByChannel.get(channel);
					if (existing) {
						existing.howl.stop(existing.soundId);
						activeSounds.delete(existing.soundId);
					}

					const howl = getAsset(sound);
					howl.volume(effectiveVolume(individualVol, channel));
					howl.loop(loop);
					const soundId = howl.play();

					const entry: MusicEntry<Ch> = {
						howl,
						soundId,
						channel,
						individualVolume: individualVol,
						assetKey: sound,
					};
					musicByChannel.set(channel, entry);
					activeSounds.set(soundId, {
						...entry,
						entityId: -1,
					});

					howl.once('end', () => {
						activeSounds.delete(soundId);
						const current = musicByChannel.get(channel);
						if (current?.soundId === soundId) {
							musicByChannel.delete(channel);
						}
					}, soundId);
				},

				stopMusic(channel) {
					if (channel !== undefined) {
						const entry = musicByChannel.get(channel);
						if (entry) {
							entry.howl.stop(entry.soundId);
							activeSounds.delete(entry.soundId);
							musicByChannel.delete(channel);
						}
					} else {
						for (const [ch, entry] of musicByChannel) {
							entry.howl.stop(entry.soundId);
							activeSounds.delete(entry.soundId);
							musicByChannel.delete(ch);
						}
					}
				},

				pauseMusic(channel) {
					if (channel !== undefined) {
						const entry = musicByChannel.get(channel);
						if (entry) entry.howl.pause(entry.soundId);
					} else {
						for (const entry of musicByChannel.values()) {
							entry.howl.pause(entry.soundId);
						}
					}
				},

				resumeMusic(channel) {
					if (channel !== undefined) {
						const entry = musicByChannel.get(channel);
						if (entry) entry.howl.play(entry.soundId);
					} else {
						for (const entry of musicByChannel.values()) {
							entry.howl.play(entry.soundId);
						}
					}
				},

				setChannelVolume(channel, volume) {
					channelVolumes.set(channel, volume);
					propagateChannelVolume(channel);
				},

				getChannelVolume(channel) {
					return channelVolumes.get(channel) ?? 1;
				},

				setMasterVolume(volume) {
					masterVolume = volume;
					propagateAllVolumes();
				},

				getMasterVolume() {
					return masterVolume;
				},

				mute() {
					muted = true;
					propagateAllVolumes();
				},

				unmute() {
					muted = false;
					propagateAllVolumes();
				},

				toggleMute() {
					muted = !muted;
					propagateAllVolumes();
				},

				isMuted() {
					return muted;
				},
			};

			world.addResource('audioState', audioState);

			// Dispose callback: stop sounds when audioSource component is removed
			world.registerDispose('audioSource', ({ value: source }: { value: AudioSource<Ch>; entityId: number }) => {
				if (source._soundId !== -1) {
					stopSoundById(source._soundId);
				}
			});

			world
				.addSystem('audio-sync')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.setOnInitialize((ecs) => {
					eventBusRef = ecs.eventBus;

					// Resolve asset getter - works with $assets resource if available
					const assets = ecs.tryGetResource<{ get(k: string): unknown }>('$assets');
					if (assets) {
						getAsset = (key: string) => assets.get(key) as Howl;
					}

					// Register reactive query for audioSource components
					ecs.addReactiveQuery('audio-sources', {
						with: ['audioSource'],
						onEnter: ({ entity }) => {
							const source = entity.components.audioSource;
							if (!getAsset) return;
							if (source._soundId !== -1) return; // Already started

							const howl = getAsset(source.sound);
							howl.volume(effectiveVolume(source.volume, source.channel));
							howl.loop(source.loop);
							const soundId = howl.play();

							source._soundId = soundId;
							source.playing = true;

							const entry: ActiveSound<Ch> = {
								howl,
								soundId,
								channel: source.channel,
								individualVolume: source.volume,
								assetKey: source.sound,
								entityId: entity.id,
							};
							activeSounds.set(soundId, entry);

							howl.once('end', () => {
								activeSounds.delete(soundId);
								source.playing = false;

								eventBusRef?.publish('soundEnded', {
									entityId: entity.id,
									soundId,
									sound: source.sound,
								} satisfies SoundEndedEvent);

								if (source.autoRemove) {
									ecs.commands.removeEntity(entity.id);
								}
							}, soundId);
						},
						onExit: (_entityId) => {
							// Cleanup handled by dispose callback
						},
					});
				})
				.setEventHandlers({
					playSound({ data, ecs }) {
						const audio = ecs.getResource('audioState');
						audio.play(data.sound, {
							channel: data.channel,
							volume: data.volume,
							loop: data.loop,
						});
					},
					stopMusic({ data, ecs }) {
						const audio = ecs.getResource('audioState');
						audio.stopMusic(data.channel);
					},
				})
				.setOnDetach(() => {
					// Stop all active sounds
					for (const entry of activeSounds.values()) {
						entry.howl.stop(entry.soundId);
					}
					activeSounds.clear();
					musicByChannel.clear();
					eventBusRef = null;
					getAsset = null;
				});
		});
}

// ==================== Post-Build Helpers ====================

/**
 * Typed helpers for the audio plugin.
 * Creates helpers that validate sound keys and channel names against the world type W.
 * Call after .build() using typeof ecs.
 *
 * @template W - Concrete ECS world type (e.g. `typeof ecs`)
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createAudioPlugin({ channels }))
 *   .withAssets(a => a.add('boom', loadSound('/sfx/boom.mp3')))
 *   .build();
 *
 * const { createAudioSource } = createAudioHelpers<typeof ecs>();
 * // Type-safe: 'boom' must be a registered asset, 'sfx' a valid channel
 * createAudioSource('boom', 'sfx');
 * ```
 */
export interface AudioHelpers<W extends AnyECSpresso> {
	createAudioSource: (
		sound: keyof AssetsOfWorld<W> & string,
		channel: ChannelOfWorld<W>,
		options?: { volume?: number; loop?: boolean; autoRemove?: boolean },
	) => Pick<AudioComponentTypes<ChannelOfWorld<W>>, 'audioSource'>;
}

export function createAudioHelpers<W extends AnyECSpresso>(_world?: W): AudioHelpers<W> {
	return {
		createAudioSource: createAudioSource as AudioHelpers<W>['createAudioSource'],
	};
}
