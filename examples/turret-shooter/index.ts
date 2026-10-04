import { createGame } from './types';
import registerInitSystems from './plugins/init-plugin';
import registerInputSystems from './plugins/input-plugin';
import registerRenderSystems from './plugins/render-plugin';
import registerPhysicsSystems from './plugins/physics-plugin';
import registerAISystems from './plugins/ai-plugin';
import registerGameplaySystems from './plugins/gameplay-plugin';
import registerUISystems from './plugins/ui-plugin';
import registerGameStateSystems from './plugins/game-state-plugin';

// These functions register application systems through SystemRegistrarOf.
// Library plugins are installed by createGame before application registration.
// Create and initialize the game
async function initGame() {
	const game = createGame();
	registerInitSystems(game);
	registerInputSystems(game);
	registerRenderSystems(game);
	registerPhysicsSystems(game);
	registerAISystems(game);
	registerGameplaySystems(game);
	registerUISystems(game);
	registerGameStateSystems(game);

	const disposeGame = () => { void game.dispose(); };
	game.addSystem('page-lifecycle')
		.setOnInitialize(() => { window.addEventListener('pagehide', disposeGame, { once: true }); })
		.setOnDetach(() => { window.removeEventListener('pagehide', disposeGame); });

	// Initialize all resources and systems
	await game.initialize();

	// Start the game
	game.eventBus.publish('gameInit', true);
}

// Start the game when the page loads
window.addEventListener('load', initGame, { once: true });
