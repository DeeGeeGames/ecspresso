/**
 * Input Plugin for ECSpresso
 *
 * Resource-only plugin — input is polled via the `inputState` resource. Provides
 * frame-accurate keyboard, pointer (mouse + touch via PointerEvent), up to 4
 * gamepads, and unified + per-player action maps.
 *
 * Mutation model: DOM events accumulate into `raw` between frames and are
 * flattened once per frame into a stable `frame` object whose Sets are cleared
 * and refilled in place (no per-frame allocations). Gamepads are polled once
 * per frame via `navigator.getGamepads()` (or an injected poll function).
 * Unified and per-player action states ping-pong two Sets (`active` / `prev`)
 * so edge detection costs nothing beyond one `.add()` per active action.
 */

import { defineSystemRef, type SystemOrderingOptions, definePlugin, type BasePluginOptions, type Vector2D } from 'ecspresso';

// ==================== Public Types ====================

// Key codes per the UI Events spec (KeyboardEvent.key values)
// https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values

type LowercaseLetter =
	| 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
	| 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

type Punctuation =
	| '`' | '~' | '!' | '@' | '#' | '$' | '%' | '^' | '&' | '*' | '(' | ')'
	| '-' | '_' | '=' | '+' | '[' | '{' | ']' | '}' | '\\' | '|'
	| ';' | ':' | "'" | '"' | ',' | '<' | '.' | '>' | '/' | '?';

type ModifierKey =
	| 'Alt' | 'AltGraph' | 'CapsLock' | 'Control' | 'Fn' | 'FnLock'
	| 'Hyper' | 'Meta' | 'NumLock' | 'ScrollLock' | 'Shift'
	| 'Super' | 'Symbol' | 'SymbolLock';

type WhitespaceKey = 'Enter' | 'Tab' | ' ';

type NavigationKey =
	| `Arrow${'Down' | 'Left' | 'Right' | 'Up'}`
	| 'End' | 'Home' | 'PageDown' | 'PageUp';

type EditingKey =
	| 'Backspace' | 'Clear' | 'Copy' | 'CrSel' | 'Cut' | 'Delete'
	| 'EraseEof' | 'ExSel' | 'Insert' | 'Paste' | 'Redo' | 'Undo';

type UIKey =
	| 'Accept' | 'Again' | 'Attn' | 'Cancel' | 'ContextMenu' | 'Escape'
	| 'Execute' | 'Find' | 'Finish' | 'Help' | 'Pause' | 'Play'
	| 'Props' | 'Select' | 'ZoomIn' | 'ZoomOut';

type DeviceKey =
	| 'BrightnessDown' | 'BrightnessUp' | 'Eject' | 'Hibernate'
	| 'LogOff' | 'Power' | 'PowerOff' | 'PrintScreen' | 'Standby' | 'WakeUp';

type IMEKey =
	| 'AllCandidates' | 'Alphanumeric' | 'CodeInput' | 'Compose' | 'Convert'
	| 'FinalMode' | 'GroupFirst' | 'GroupLast' | 'GroupNext' | 'GroupPrevious'
	| 'ModeChange' | 'NextCandidate' | 'NonConvert' | 'PreviousCandidate'
	| 'Process' | 'SingleCandidate'
	| 'HangulMode' | 'HanjaMode' | 'JunjaMode'
	| 'Eisu' | 'Hankaku' | 'Hiragana' | 'HiraganaKatakana' | 'KanaMode'
	| 'KanjiMode' | 'Katakana' | 'Romaji' | 'Zenkaku' | 'ZenkakuHankaku';

type FunctionKey =
	| `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24}`
	| 'Soft1' | 'Soft2' | 'Soft3' | 'Soft4';

type PhoneKey =
	| 'AppSwitch' | 'Call' | 'Camera' | 'CameraFocus' | 'EndCall'
	| 'GoBack' | 'GoHome' | 'HeadsetHook' | 'LastNumberRedial'
	| 'Notification' | 'MannerMode' | 'VoiceDial';

type MultimediaKey =
	| 'ChannelDown' | 'ChannelUp'
	| `Media${
		'FastForward' | 'Pause' | 'Play' | 'PlayPause'
		| 'Record' | 'Rewind' | 'Stop' | 'TrackNext' | 'TrackPrevious'
	}`;

type AudioKey =
	| `Audio${
		'BalanceLeft' | 'BalanceRight' | 'BassDown' | 'BassBoostDown'
		| 'BassBoostToggle' | 'BassBoostUp' | 'BassUp' | 'FaderFront' | 'FaderRear'
		| 'SurroundModeNext' | 'TrebleDown' | 'TrebleUp'
		| 'VolumeDown' | 'VolumeMute' | 'VolumeUp'
	}`
	| `Microphone${'Toggle' | 'VolumeDown' | 'VolumeMute' | 'VolumeUp'}`;

type TVKey =
	| 'TV'
	| `TV${
		'3DMode' | 'AntennaCable' | 'AudioDescription' | 'AudioDescriptionMixDown'
		| 'AudioDescriptionMixUp' | 'ContentsMenu' | 'DataService' | 'Input'
		| 'InputComponent1' | 'InputComponent2' | 'InputComposite1' | 'InputComposite2'
		| 'InputHDMI1' | 'InputHDMI2' | 'InputHDMI3' | 'InputHDMI4' | 'InputVGA1'
		| 'MediaContext' | 'Network' | 'NumberEntry' | 'Power' | 'RadioService'
		| 'Satellite' | 'SatelliteBS' | 'SatelliteCS' | 'SatelliteToggle'
		| 'TerrestrialAnalog' | 'TerrestrialDigital' | 'Timer'
	}`;

type MediaControllerKey =
	| 'AVRInput' | 'AVRPower'
	| `Color${'F0Red' | 'F1Green' | 'F2Yellow' | 'F3Blue' | 'F4Grey' | 'F5Brown'}`
	| 'ClosedCaptionToggle' | 'Dimmer' | 'DisplaySwap' | 'DVR' | 'Exit'
	| `Favorite${'Clear' | 'Recall' | 'Store'}${0 | 1 | 2 | 3}`
	| 'Guide' | 'GuideNextDay' | 'GuidePreviousDay' | 'Info' | 'InstantReplay'
	| 'Link' | 'ListProgram' | 'LiveContent' | 'Lock'
	| `Media${
		'Apps' | 'AudioTrack' | 'Last' | 'SkipBackward'
		| 'SkipForward' | 'StepBackward' | 'StepForward' | 'TopMenu'
	}`
	| `Navigate${'In' | 'Next' | 'Out' | 'Previous'}`
	| 'NextFavoriteChannel' | 'NextUserProfile' | 'OnDemand' | 'Pairing'
	| `PinP${'Down' | 'Move' | 'Toggle' | 'Up'}`
	| `PlaySpeed${'Down' | 'Reset' | 'Up'}`
	| 'RandomToggle' | 'RcLowBattery' | 'RecordSpeedNext' | 'RfBypass'
	| 'ScanChannelsToggle' | 'ScreenModeNext' | 'Settings' | 'SplitScreenToggle'
	| 'STBInput' | 'STBPower' | 'Subtitle' | 'Teletext'
	| 'VideoModeNext' | 'Wink' | 'ZoomToggle';

type SpeechKey = 'SpeechCorrectionList' | 'SpeechInputToggle';

type DocumentKey =
	| 'Close' | 'New' | 'Open' | 'Print' | 'Save' | 'SpellCheck'
	| 'MailForward' | 'MailReply' | 'MailSend';

type LaunchKey = `Launch${
	| 'Calculator' | 'Calendar' | 'Contacts' | 'Mail' | 'MediaPlayer'
	| 'MusicPlayer' | 'MyComputer' | 'Phone' | 'ScreenSaver' | 'Spreadsheet'
	| 'WebBrowser' | 'WebCam' | 'WordProcessor'
	| `Application${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16}`
}`;

type BrowserKey = `Browser${'Back' | 'Favorites' | 'Forward' | 'Home' | 'Refresh' | 'Search' | 'Stop'}`;

type NumpadKey = 'Decimal' | 'Key11' | 'Key12' | 'Multiply' | 'Add' | 'Divide' | 'Subtract' | 'Separator';

export type KeyCode =
	| LowercaseLetter | Uppercase<LowercaseLetter> | Digit | Punctuation
	| ModifierKey | WhitespaceKey | NavigationKey | EditingKey | UIKey | DeviceKey
	| IMEKey | FunctionKey | PhoneKey | MultimediaKey | AudioKey | TVKey
	| MediaControllerKey | SpeechKey | DocumentKey | LaunchKey | BrowserKey | NumpadKey
	| 'Unidentified' | 'Dead';

export interface KeyboardState {
	isDown(key: KeyCode): boolean;
	justPressed(key: KeyCode): boolean;
	justReleased(key: KeyCode): boolean;
}

export interface PointerState {
	readonly position: Readonly<Vector2D>;
	readonly delta: Readonly<Vector2D>;
	isDown(button: number): boolean;
	justPressed(button: number): boolean;
	justReleased(button: number): boolean;
}

export interface GamepadState {
	readonly connected: boolean;
	readonly id: string | null;
	isDown(button: number): boolean;
	justPressed(button: number): boolean;
	justReleased(button: number): boolean;
	/** Analog button value in [0, 1]. Useful for triggers. Returns 0 when disconnected or out of range. */
	buttonValue(button: number): number;
	/** Deadzone-applied axis value in [-1, 1]. Sticks use radial deadzone on axis pairs (0,1) and (2,3). */
	axis(index: number): number;
	/** Raw axis value in [-1, 1] with no deadzone applied. */
	rawAxis(index: number): number;
}

export interface ActionState<A extends string = string> {
	isActive(action: A): boolean;
	justActivated(action: A): boolean;
	justDeactivated(action: A): boolean;
}

export interface PlayerInput<A extends string = string> {
	readonly actions: ActionState<A>;
	setActionMap(map: ActionMap<A>): void;
	getActionMap(): Readonly<ActionMap<A>>;
}

export interface InputState<A extends string = string> {
	readonly keyboard: KeyboardState;
	readonly pointer: PointerState;
	/** Always length 4 (standard web gamepad slot count). Disconnected slots return `connected: false`. */
	readonly gamepads: ReadonlyArray<GamepadState>;
	/** Unified action state — fires when any bound input (keyboard, pointer, any pad) is active. Intended for menu/shared input. */
	readonly actions: ActionState<A>;
	setActionMap(actions: ActionMap<A>): void;
	getActionMap(): Readonly<ActionMap<A>>;
	/** Register or replace a player's action map. Per-player states are isolated from the unified `actions`. */
	definePlayer(id: string, map: ActionMap<A>): void;
	/** Returns true if the player existed and was removed. */
	removePlayer(id: string): boolean;
	/** Returns a handle to a registered player's input, or undefined if no such player. */
	player(id: string): PlayerInput<A> | undefined;
	playerIds(): readonly string[];
}

export interface GamepadButtonRef {
	pad: number;
	button: number;
}

export interface GamepadAxisRef {
	pad: number;
	axis: number;
	/** Which half of the axis counts as "active". */
	direction: 1 | -1;
	/** Magnitude at which the axis triggers the action. Applied to the deadzone-adjusted axis value. Default: 0.5. */
	threshold?: number;
}

export interface ActionBinding {
	keys?: KeyCode[];
	/** Pointer (mouse/touch) button indices — 0 = primary, 1 = auxiliary, 2 = secondary, etc. */
	pointerButtons?: number[];
	gamepadButtons?: GamepadButtonRef[];
	gamepadAxes?: GamepadAxisRef[];
}

export type ActionMap<A extends string = string> = Record<A, ActionBinding>;

export interface InputResourceTypes<A extends string = string> {
	inputState: InputState<A>;
}

/**
 * Minimal gamepad shape required by the injectable poll function. A structural
 * subset of the browser `Gamepad` interface — `navigator.getGamepads()` satisfies
 * it directly, and test doubles can supply just these fields.
 */
export interface GamepadLike {
	id: string;
	connected: boolean;
	buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
	axes: ReadonlyArray<number>;
}

export interface GamepadOptions {
	/** Radial deadzone applied to stick pairs (axes 0,1 and 2,3). Value in [0, 1]. Default: 0.15. */
	deadzone?: number;
	/**
	 * Custom poll function returning up to 4 gamepad slots. Defaults to `navigator.getGamepads()`.
	 * Primarily an injection point for tests; in the browser the default is correct.
	 */
	poll?: () => ReadonlyArray<GamepadLike | null>;
}

/** Public processing references. Factory before/after options target `update` only. */
export const inputSystems = Object.freeze({
	update: defineSystemRef('input.input.update'),
});

export interface InputPluginOptions<A extends string = string, G extends string = 'input'> extends BasePluginOptions<G>, SystemOrderingOptions {
	/** Initial unified action map. */
	actions?: ActionMap<A>;
	/** Initial per-player action maps, keyed by player id. */
	players?: Record<string, ActionMap<A>>;
	/** EventTarget to attach listeners to (default: globalThis). Pass a custom target for testability. */
	target?: EventTarget;
	/** Gamepad polling and deadzone configuration. */
	gamepad?: GamepadOptions;
	/**
	 * Optional conversion from raw DOM client coordinates to the space `inputState.pointer.position` should report.
	 * Renderer-agnostic: wire to `clientToLogical(...)` from renderer2D when using `screenScale`, or to a renderer-specific helper.
	 * When omitted, pointer coords remain raw `clientX`/`clientY` (not canvas-relative).
	 */
	coordinateTransform?: (clientX: number, clientY: number) => { x: number; y: number };
	/**
	 * Keys whose browser default behaviour should be suppressed (e.g. `['Tab', ' ', 'ArrowDown']`).
	 * Ignored when `shouldPreventDefault` is provided.
	 */
	preventDefaultKeys?: KeyCode[];
	/**
	 * Pointer button indices whose browser default behaviour should be suppressed (e.g. `[0, 2]`).
	 * Ignored when `shouldPreventDefault` is provided.
	 */
	preventDefaultPointerButtons?: number[];
	/**
	 * Custom predicate for full control over `preventDefault`. Receives the raw DOM event and returns
	 * `true` to suppress its default behaviour. When provided, `preventDefaultKeys` and
	 * `preventDefaultPointerButtons` are ignored.
	 */
	shouldPreventDefault?: (event: KeyboardEvent | PointerEvent) => boolean;
}

// ==================== Helper Functions ====================

/** Create a single action binding. Identity function that provides type inference for inline literals. */
export function createActionBinding(binding: ActionBinding): ActionBinding {
	return binding;
}

/** Build an array of gamepad button refs scoped to one pad — `gamepadButtonsOn(0, 0, 1, 9)` = pad 0's buttons 0, 1, 9. */
export function gamepadButtonsOn(pad: number, ...buttons: number[]): GamepadButtonRef[] {
	return buttons.map((button) => ({ pad, button }));
}

/** Build a gamepad axis ref. `threshold` defaults to 0.5 at activation time. */
export function gamepadAxisOn(pad: number, axis: number, direction: 1 | -1, threshold?: number): GamepadAxisRef {
	return threshold === undefined ? { pad, axis, direction } : { pad, axis, direction, threshold };
}

// ==================== Internal Types ====================

interface RawKeyPointerState {
	keysDown: Set<string>;
	keysPressed: string[];
	keysReleased: string[];
	pointerButtonsDown: Set<number>;
	pointerButtonsPressed: number[];
	pointerButtonsReleased: number[];
	pointerX: number;
	pointerY: number;
	lastPointerX: number;
	lastPointerY: number;
	pointerMoved: boolean;
}

/**
 * Stable per-frame view of keyboard + pointer input. Sets are mutated in place
 * each frame (cleared and refilled from raw), so closures over this object see
 * consistent state throughout a frame without per-frame Set allocation.
 */
interface FrameState {
	keysDown: Set<string>;
	keysPressed: Set<string>;
	keysReleased: Set<string>;
	pointerButtonsDown: Set<number>;
	pointerButtonsPressed: Set<number>;
	pointerButtonsReleased: Set<number>;
	pointerX: number;
	pointerY: number;
	pointerDeltaX: number;
	pointerDeltaY: number;
}

interface PadRuntime {
	connected: boolean;
	id: string | null;
	buttonsDown: Set<number>;
	buttonsPrev: Set<number>;
	buttonsPressed: Set<number>;
	buttonsReleased: Set<number>;
	buttonValues: number[];
	axes: number[];
	rawAxes: number[];
}

/** Two ping-ponged Sets backing an ActionState. Each frame we swap `active` ↔ `prev`, clear the new `active`, and refill. */
interface ActionSlot {
	active: Set<string>;
	prev: Set<string>;
}

// ==================== Helpers ====================

const DEFAULT_AXIS_THRESHOLD = 0.5;
const DEFAULT_DEADZONE = 0.15;
const PAD_COUNT = 4;

function createRawKeyPointerState(): RawKeyPointerState {
	return {
		keysDown: new Set(),
		keysPressed: [],
		keysReleased: [],
		pointerButtonsDown: new Set(),
		pointerButtonsPressed: [],
		pointerButtonsReleased: [],
		pointerX: 0,
		pointerY: 0,
		lastPointerX: 0,
		lastPointerY: 0,
		pointerMoved: false,
	};
}

function createFrameState(): FrameState {
	return {
		keysDown: new Set(),
		keysPressed: new Set(),
		keysReleased: new Set(),
		pointerButtonsDown: new Set(),
		pointerButtonsPressed: new Set(),
		pointerButtonsReleased: new Set(),
		pointerX: 0,
		pointerY: 0,
		pointerDeltaX: 0,
		pointerDeltaY: 0,
	};
}

function createPadRuntime(): PadRuntime {
	return {
		connected: false,
		id: null,
		buttonsDown: new Set(),
		buttonsPrev: new Set(),
		buttonsPressed: new Set(),
		buttonsReleased: new Set(),
		buttonValues: [],
		axes: [],
		rawAxes: [],
	};
}

function createActionSlot(): ActionSlot {
	return { active: new Set(), prev: new Set() };
}

function refillSet<T>(dest: Set<T>, source: Iterable<T>): void {
	dest.clear();
	for (const item of source) dest.add(item);
}

function updateFrameStateFromRaw(frame: FrameState, raw: RawKeyPointerState): void {
	refillSet(frame.keysDown, raw.keysDown);
	refillSet(frame.keysPressed, raw.keysPressed);
	refillSet(frame.keysReleased, raw.keysReleased);
	refillSet(frame.pointerButtonsDown, raw.pointerButtonsDown);
	refillSet(frame.pointerButtonsPressed, raw.pointerButtonsPressed);
	refillSet(frame.pointerButtonsReleased, raw.pointerButtonsReleased);

	frame.pointerDeltaX = raw.pointerMoved ? raw.pointerX - raw.lastPointerX : 0;
	frame.pointerDeltaY = raw.pointerMoved ? raw.pointerY - raw.lastPointerY : 0;
	frame.pointerX = raw.pointerX;
	frame.pointerY = raw.pointerY;

	raw.keysPressed.length = 0;
	raw.keysReleased.length = 0;
	raw.pointerButtonsPressed.length = 0;
	raw.pointerButtonsReleased.length = 0;
	raw.lastPointerX = raw.pointerX;
	raw.lastPointerY = raw.pointerY;
	raw.pointerMoved = false;
}

function defaultPoll(out: Array<GamepadLike | null>): () => ReadonlyArray<GamepadLike | null> {
	return () => {
		if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
			for (let i = 0; i < out.length; i++) out[i] = null;
			return out;
		}
		const pads = navigator.getGamepads();
		for (let i = 0; i < out.length; i++) out[i] = pads[i] ?? null;
		return out;
	};
}

function applyStickDeadzone(x: number, y: number, deadzone: number, out: number[], baseIndex: number): void {
	const mag = Math.sqrt(x * x + y * y);
	if (mag < deadzone) {
		out[baseIndex] = 0;
		out[baseIndex + 1] = 0;
		return;
	}
	const scaled = Math.min((mag - deadzone) / (1 - deadzone), 1);
	out[baseIndex] = (x / mag) * scaled;
	out[baseIndex + 1] = (y / mag) * scaled;
}

function applyAxisDeadzoning(rawAxes: number[], axes: number[], deadzone: number): void {
	axes.length = rawAxes.length;
	if (rawAxes.length >= 2) {
		applyStickDeadzone(rawAxes[0] ?? 0, rawAxes[1] ?? 0, deadzone, axes, 0);
	}
	if (rawAxes.length >= 4) {
		applyStickDeadzone(rawAxes[2] ?? 0, rawAxes[3] ?? 0, deadzone, axes, 2);
	}
	// Axes beyond the two standard sticks pass through with no deadzone (triggers, dpad-as-axis, etc.)
	for (let i = 4; i < rawAxes.length; i++) {
		axes[i] = rawAxes[i] ?? 0;
	}
}

function pollGamepadsInto(pads: PadRuntime[], pollFn: () => ReadonlyArray<GamepadLike | null>, deadzone: number): void {
	const polled = pollFn();
	for (let i = 0; i < PAD_COUNT; i++) {
		const pad = polled[i] ?? null;
		const state = pads[i];
		if (!state) continue;

		// Rotate button sets using the existing `prev` set as scratch, then clear what we'll refill.
		const reusedPrev = state.buttonsPrev;
		refillSet(reusedPrev, state.buttonsDown);
		state.buttonsDown.clear();
		state.buttonsPressed.clear();
		state.buttonsReleased.clear();

		if (!pad || !pad.connected) {
			if (state.connected) {
				// Newly disconnected: synthesize justReleased for anything that was held, then clear values.
				for (const b of reusedPrev) state.buttonsReleased.add(b);
				state.connected = false;
				state.id = null;
				state.buttonValues.length = 0;
				state.axes.length = 0;
				state.rawAxes.length = 0;
			}
			continue;
		}

		state.connected = true;
		state.id = pad.id;

		state.buttonValues.length = pad.buttons.length;
		for (let b = 0; b < pad.buttons.length; b++) {
			const info = pad.buttons[b];
			if (!info) {
				state.buttonValues[b] = 0;
				continue;
			}
			state.buttonValues[b] = info.value;
			if (info.pressed) state.buttonsDown.add(b);
		}

		for (const b of state.buttonsDown) {
			if (!reusedPrev.has(b)) state.buttonsPressed.add(b);
		}
		for (const b of reusedPrev) {
			if (!state.buttonsDown.has(b)) state.buttonsReleased.add(b);
		}

		state.rawAxes.length = pad.axes.length;
		for (let a = 0; a < pad.axes.length; a++) {
			state.rawAxes[a] = pad.axes[a] ?? 0;
		}
		applyAxisDeadzoning(state.rawAxes, state.axes, deadzone);
	}
}

function isBindingActive(
	binding: ActionBinding,
	keysDown: ReadonlySet<string>,
	pointerButtonsDown: ReadonlySet<number>,
	pads: ReadonlyArray<PadRuntime>,
): boolean {
	if (binding.keys?.some((k) => keysDown.has(k))) return true;
	if (binding.pointerButtons?.some((b) => pointerButtonsDown.has(b))) return true;
	if (binding.gamepadButtons?.some(({ pad, button }) => pads[pad]?.buttonsDown.has(button) ?? false)) return true;
	if (binding.gamepadAxes?.some(({ pad, axis, direction, threshold = DEFAULT_AXIS_THRESHOLD }) => {
		const value = pads[pad]?.axes[axis] ?? 0;
		return direction > 0 ? value > threshold : value < -threshold;
	})) return true;
	return false;
}

/**
 * Recompute the slot's `active` set in place from `map` against current input sources.
 * Rotates `active` ↔ `prev` (reusing Set instances) so edge detection works with no allocations.
 */
function advanceActionSlot(
	slot: ActionSlot,
	map: ActionMap,
	keysDown: ReadonlySet<string>,
	pointerButtonsDown: ReadonlySet<number>,
	pads: ReadonlyArray<PadRuntime>,
): void {
	const nextActive = slot.prev;
	slot.prev = slot.active;
	slot.active = nextActive;
	nextActive.clear();

	for (const [name, binding] of Object.entries(map)) {
		if (isBindingActive(binding, keysDown, pointerButtonsDown, pads)) nextActive.add(name);
	}
}

function makeActionState<A extends string>(slot: ActionSlot): ActionState<A> {
	return {
		isActive: (action) => slot.active.has(action),
		justActivated: (action) => slot.active.has(action) && !slot.prev.has(action),
		justDeactivated: (action) => !slot.active.has(action) && slot.prev.has(action),
	};
}

// ==================== Plugin Factory ====================

/**
 * Create an input plugin for ECSpresso.
 *
 * Provides:
 * - Frame-accurate keyboard state (isDown, justPressed, justReleased)
 * - Pointer position/delta and button state (mouse + touch via PointerEvent)
 * - Up to 4 gamepads polled per frame, with radial deadzone on sticks and analog button values
 * - Unified action mapping (keyboard + pointer + any pad)
 * - Per-player action maps for local co-op (`definePlayer`, `player(id)`)
 * - Automatic listener cleanup on detach
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createInputPlugin({
 *     actions: {
 *       jump: { keys: [' ', 'ArrowUp'], gamepadButtons: [{ pad: 0, button: 0 }] },
 *       shoot: { keys: ['z'], pointerButtons: [0] },
 *     },
 *     players: {
 *       p1: { jump: { keys: [' '] }, shoot: { keys: ['z'] } },
 *       p2: {
 *         jump: { gamepadButtons: gamepadButtonsOn(0, 0) },
 *         shoot: { gamepadButtons: gamepadButtonsOn(0, 2) },
 *       },
 *     },
 *   }))
 *   .build();
 *
 * const input = ecs.getResource('inputState');
 * if (input.actions.justActivated('jump')) { ... }              // any source
 * if (input.player('p1')?.actions.isActive('jump')) { ... }      // just player 1
 * if (input.gamepads[0].isDown(0)) { ... }                       // raw pad 0 A-button
 * ```
 */
export function createInputPlugin<A extends string = string, G extends string = 'input'>(
	options?: InputPluginOptions<A, G>
) {
	const {
		systemGroup = 'input',
		priority = 100,
		phase = 'preUpdate',
		target = globalThis,
		gamepad: gamepadOpts = {},
		coordinateTransform,
		shouldPreventDefault,
		preventDefaultKeys,
		preventDefaultPointerButtons,
	} = options ?? {};

	const preventKeySet = new Set<string>(preventDefaultKeys ?? []);
	const preventPointerSet = new Set<number>(preventDefaultPointerButtons ?? []);

	function checkPreventDefault(e: KeyboardEvent | PointerEvent): void {
		if (shouldPreventDefault) {
			if (shouldPreventDefault(e)) e.preventDefault();
			return;
		}
		if ('key' in e) {
			if (preventKeySet.has(e.key)) e.preventDefault();
		} else {
			if (preventPointerSet.has(e.button)) e.preventDefault();
		}
	}

	return definePlugin('input')
		.withResourceTypes<InputResourceTypes<A>>()
		.withLabels<'input-state'>()
		.withGroups<G>()
		.install((world) => {
			// Option default casts: option defaults of `{}` don't structurally satisfy a narrow `ActionMap<A>`,
			// but at this boundary we know the user either supplied a valid map or is using A = string.
			const unifiedActionMap = { ...(options?.actions ?? {}) } as ActionMap<A>;
			const playerMaps = new Map<string, ActionMap<A>>(
				Object.entries(options?.players ?? {}) as Array<[string, ActionMap<A>]>,
			);

			const deadzone = gamepadOpts.deadzone ?? DEFAULT_DEADZONE;
			const pollFn = gamepadOpts.poll ?? defaultPoll(new Array<GamepadLike | null>(PAD_COUNT).fill(null));

			const raw = createRawKeyPointerState();
			const frame = createFrameState();
			const pads: PadRuntime[] = Array.from({ length: PAD_COUNT }, createPadRuntime);
			const unifiedSlot = createActionSlot();
			const playerSlots = new Map<string, ActionSlot>();
			const playerHandles = new Map<string, PlayerInput<A>>();
			const cleanupFns: Array<() => void> = [];

			// Vector2Ds exposed via the resource — updated in place each frame.
			const position: Vector2D = { x: 0, y: 0 };
			const delta: Vector2D = { x: 0, y: 0 };

			let currentUnifiedMap = unifiedActionMap;

			const keyboard: KeyboardState = {
				isDown: (key) => frame.keysDown.has(key),
				justPressed: (key) => frame.keysPressed.has(key),
				justReleased: (key) => frame.keysReleased.has(key),
			};

			const pointer: PointerState = {
				position,
				delta,
				isDown: (button) => frame.pointerButtonsDown.has(button),
				justPressed: (button) => frame.pointerButtonsPressed.has(button),
				justReleased: (button) => frame.pointerButtonsReleased.has(button),
			};

			function makeGamepadState(index: number): GamepadState {
				const state = pads[index];
				if (!state) throw new Error(`Invalid gamepad index: ${index}`);
				return {
					get connected() { return state.connected; },
					get id() { return state.id; },
					isDown: (button) => state.buttonsDown.has(button),
					justPressed: (button) => state.buttonsPressed.has(button),
					justReleased: (button) => state.buttonsReleased.has(button),
					buttonValue: (button) => state.buttonValues[button] ?? 0,
					axis: (index) => state.axes[index] ?? 0,
					rawAxis: (index) => state.rawAxes[index] ?? 0,
				};
			}

			const gamepadStates: ReadonlyArray<GamepadState> = Array.from({ length: PAD_COUNT }, (_, i) => makeGamepadState(i));

			const unifiedActions = makeActionState<A>(unifiedSlot);

			function ensurePlayerSlot(id: string): ActionSlot {
				const existing = playerSlots.get(id);
				if (existing) return existing;
				const slot = createActionSlot();
				playerSlots.set(id, slot);
				return slot;
			}

			function createPlayerHandle(id: string): PlayerInput<A> {
				const slot = ensurePlayerSlot(id);
				return {
					actions: makeActionState<A>(slot),
					setActionMap: (map) => {
						if (!playerMaps.has(id)) throw new Error(`Player '${id}' was removed`);
						playerMaps.set(id, { ...map });
					},
					getActionMap: () => {
						const map = playerMaps.get(id);
						if (!map) throw new Error(`Player '${id}' was removed`);
						return { ...map };
					},
				};
			}

			for (const id of playerMaps.keys()) {
				playerHandles.set(id, createPlayerHandle(id));
			}

			const inputState: InputState<A> = {
				keyboard,
				pointer,
				gamepads: gamepadStates,
				actions: unifiedActions,
				setActionMap(newMap) {
					currentUnifiedMap = { ...newMap };
				},
				getActionMap() {
					return { ...currentUnifiedMap };
				},
				definePlayer(id, map) {
					playerMaps.set(id, { ...map });
					if (!playerHandles.has(id)) playerHandles.set(id, createPlayerHandle(id));
				},
				removePlayer(id) {
					const existed = playerMaps.delete(id);
					playerHandles.delete(id);
					playerSlots.delete(id);
					return existed;
				},
				player(id) {
					return playerHandles.get(id);
				},
				playerIds() {
					return Array.from(playerMaps.keys());
				},
			};

			function onKeyDown(e: Event) {
				const ke = e as KeyboardEvent;
				if (ke.repeat) return;
				checkPreventDefault(ke);
				raw.keysDown.add(ke.key);
				raw.keysPressed.push(ke.key);
			}

			function onKeyUp(e: Event) {
				const ke = e as KeyboardEvent;
				checkPreventDefault(ke);
				raw.keysDown.delete(ke.key);
				raw.keysReleased.push(ke.key);
			}

			function onPointerDown(e: Event) {
				const pe = e as PointerEvent;
				checkPreventDefault(pe);
				raw.pointerButtonsDown.add(pe.button);
				raw.pointerButtonsPressed.push(pe.button);
			}

			function onPointerMove(e: Event) {
				const pe = e as PointerEvent;
				if (coordinateTransform) {
					const { x, y } = coordinateTransform(pe.clientX, pe.clientY);
					raw.pointerX = x;
					raw.pointerY = y;
				} else {
					raw.pointerX = pe.clientX;
					raw.pointerY = pe.clientY;
				}
				raw.pointerMoved = true;
			}

			function onPointerUp(e: Event) {
				const pe = e as PointerEvent;
				checkPreventDefault(pe);
				raw.pointerButtonsDown.delete(pe.button);
				raw.pointerButtonsReleased.push(pe.button);
			}

			function addListener(type: string, handler: (e: Event) => void) {
				target.addEventListener(type, handler);
				cleanupFns.push(() => { target.removeEventListener(type, handler); });
			}

			world.addResource('inputState', inputState);

			world
				.addSystem('input-state')
				.withRef(inputSystems.update)
				.before(...options?.before ?? [])
				.after(...options?.after ?? [])
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.setOnInitialize(() => {
					addListener('keydown', onKeyDown);
					addListener('keyup', onKeyUp);
					addListener('pointerdown', onPointerDown);
					addListener('pointermove', onPointerMove);
					addListener('pointerup', onPointerUp);
				})
				.setOnDetach(() => {
					for (const cleanup of cleanupFns) cleanup();
					cleanupFns.length = 0;
				})
				.setProcess(() => {
					// Pads must be polled before action computation so a single frame reflects
					// both DOM-driven (keyboard/pointer) and polled (gamepad) sources consistently.
					pollGamepadsInto(pads, pollFn, deadzone);
					updateFrameStateFromRaw(frame, raw);

					position.x = frame.pointerX;
					position.y = frame.pointerY;
					delta.x = frame.pointerDeltaX;
					delta.y = frame.pointerDeltaY;

					advanceActionSlot(unifiedSlot, currentUnifiedMap, frame.keysDown, frame.pointerButtonsDown, pads);
					for (const [id, map] of playerMaps) {
						const slot = ensurePlayerSlot(id);
						advanceActionSlot(slot, map, frame.keysDown, frame.pointerButtonsDown, pads);
					}
				});
		});
}
