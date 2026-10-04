/**
 * React UI Overlay Example
 *
 * Demonstrates bridging ECS state into a React component tree via
 * subscription-based hooks (useResource, useEvent). The React overlay
 * sits on top of the PixiJS canvas as a standard DOM layer.
 */
import { createRoot } from 'react-dom/client';
import { EcsContext } from 'ecspresso/bindings/react';
import { GameUI } from './ui';
import { initGame } from './game';

const ecs = await initGame();

const uiRoot = document.getElementById('ui-root');
if (!uiRoot) throw new Error('Missing #ui-root element');

createRoot(uiRoot).render(
	<EcsContext.Provider value={ecs}>
		<GameUI />
	</EcsContext.Provider>,
);
