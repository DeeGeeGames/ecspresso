import { describe, expect, spyOn, test } from 'bun:test';
import { Container, Texture, TextureSource } from 'pixi.js';
import { createSceneAssets } from './scene';

describe('sprite-animation scene ownership', () => {
	test('releases shared frames once, destroys caller objects, and cancels listeners', () => {
		const assets = createSceneAssets();
		const source = new TextureSource({ width: 1, height: 1 });
		const frame = new Texture({ source });
		const destroyFrame = spyOn(frame, 'destroy');
		const object = assets.own(new Container());
		const target = new EventTarget();
		let clicks = 0;
		target.addEventListener('click', function countClick() { clicks += 1; }, { signal: assets.listeners.signal });
		assets.frames([frame, frame]);
		assets.frames([frame]); // Several animation entities share this frame.
		target.dispatchEvent(new Event('click'));
		expect(clicks).toBe(1);

		assets.dispose();
		target.dispatchEvent(new Event('click'));
		expect(clicks).toBe(1);
		expect(object.destroyed).toBe(true);
		expect(source.destroyed).toBe(true);
		expect(destroyFrame).toHaveBeenCalledTimes(1);
		expect(destroyFrame).toHaveBeenCalledWith(true);

		assets.dispose();
		expect(destroyFrame).toHaveBeenCalledTimes(1);
		destroyFrame.mockRestore();
	});
});
