/**
 * React UI overlay — subscribes to ECS resources and events.
 */
import { useState } from 'react';
import { createEcsHooks } from 'ecspresso/bindings/react';
import type { ECS } from './game';
import { crossedHealthMilestones } from './health-milestones';

const { useEcs, useResource, useEvent } = createEcsHooks<ECS>();

// ── HUD (top bar) ──

function ScoreDisplay() {
	const score = useResource('score');
	return <div style={styles.stat}>Score: {score}</div>;
}

function HealthBar() {
	const health = useResource('health');
	const pct = Math.max(0, Math.min(100, health));
	const barColor = pct > 50 ? '#4ecdc4' : pct > 25 ? '#ffe66d' : '#ff6b6b';

	return (
		<div style={styles.healthContainer}>
			<div style={styles.stat}>HP</div>
			<div style={styles.healthTrack}>
				<div
					style={{
						...styles.healthFill,
						width: `${pct}%`,
						backgroundColor: barColor,
					}}
				/>
			</div>
			<div style={styles.stat}>{Math.round(pct)}</div>
		</div>
	);
}

function BallCount() {
	const count = useResource('ballCount');
	return <div style={styles.stat}>Balls: {count}</div>;
}

function PauseButton() {
	const paused = useResource('paused');
	const ecs = useEcs();

	return (
		<button
			style={{
				...styles.button,
				...(paused ? styles.buttonActive : {}),
			}}
			onPointerDown={(e) => {
				e.stopPropagation();
				ecs.setResource('paused', !paused);
			}}
		>
			{paused ? '▶ Resume' : '⏸ Pause'}
		</button>
	);
}

// ── Event log (demonstrates useEvent) ──

function EventLog() {
	const [log, setLog] = useState<string[]>([]);

	useEvent('ballBounced', ({ entityId }) => {
		setLog((prev) => [`Ball ${entityId} bounced`, ...prev].slice(0, 8));
	});

	useEvent('healthChanged', ({ prev, next }) => {
		const crossed = crossedHealthMilestones(prev, next);
		if (crossed.length === 0) return;
		setLog((entries) => [
			...crossed.map(function milestone(threshold) { return `Health at ${threshold}%`; }).reverse(),
			...entries,
		].slice(0, 8));
	});

	return (
		<div style={styles.eventLog}>
			<div style={styles.eventLogTitle}>Events</div>
			{log.map((entry, i) => (
				<div key={`${entry}-${i}`} style={{
					...styles.eventEntry,
					opacity: 1 - i * 0.1,
				}}>
					{entry}
				</div>
			))}
		</div>
	);
}

// ── Root overlay ──

export function GameUI() {
	return (
		<div style={styles.overlay}>
			<div style={styles.topBar}>
				<ScoreDisplay />
				<HealthBar />
				<BallCount />
				<PauseButton />
			</div>
			<EventLog />
		</div>
	);
}

// ── Styles ──

const styles = {
	overlay: {
		position: 'absolute',
		inset: 0,
		pointerEvents: 'none',
		fontFamily: "'Segoe UI', system-ui, sans-serif",
		color: '#e0e0e0',
		fontSize: '14px',
		zIndex: 5,
	},
	topBar: {
		position: 'absolute',
		top: '16px',
		right: '16px',
		display: 'flex',
		flexDirection: 'column',
		gap: '10px',
		padding: '12px 16px',
		background: 'rgba(0, 0, 0, 0.5)',
		backdropFilter: 'blur(4px)',
		borderRadius: '6px',
		minWidth: '180px',
	},
	stat: {
		fontWeight: 600,
		whiteSpace: 'nowrap',
	},
	healthContainer: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
	},
	healthTrack: {
		flex: 1,
		height: '12px',
		backgroundColor: 'rgba(255, 255, 255, 0.15)',
		borderRadius: '6px',
		overflow: 'hidden',
	},
	healthFill: {
		height: '100%',
		borderRadius: '6px',
		transition: 'width 0.15s ease-out, background-color 0.3s',
	},
	button: {
		pointerEvents: 'auto',
		alignSelf: 'stretch',
		padding: '6px 14px',
		border: '1px solid rgba(255, 255, 255, 0.3)',
		borderRadius: '4px',
		background: 'rgba(255, 255, 255, 0.1)',
		color: '#e0e0e0',
		cursor: 'pointer',
		fontSize: '13px',
		fontWeight: 600,
	},
	buttonActive: {
		background: 'rgba(78, 205, 196, 0.3)',
		borderColor: '#4ecdc4',
	},
	eventLog: {
		position: 'absolute',
		bottom: '16px',
		right: '16px',
		width: '200px',
		padding: '10px 12px',
		background: 'rgba(0, 0, 0, 0.5)',
		backdropFilter: 'blur(4px)',
		borderRadius: '6px',
	},
	eventLogTitle: {
		fontWeight: 700,
		marginBottom: '6px',
		fontSize: '12px',
		textTransform: 'uppercase',
		letterSpacing: '0.5px',
		color: '#888',
	},
	eventEntry: {
		fontSize: '12px',
		padding: '2px 0',
		color: '#ccc',
	},
} as const;
