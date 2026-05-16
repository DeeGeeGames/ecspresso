use bevy::asset::RenderAssetUsages;
use bevy::camera::ScalingMode;
use bevy::image::{Image, ImageSampler};
use bevy::input::mouse::AccumulatedMouseScroll;
use bevy::log::info;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::window::{PrimaryWindow, Window, WindowPlugin};
use std::cell::Cell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;

const SCREEN_W: f32 = 1920.0;
const SCREEN_H: f32 = 1080.0;
const WORLD_W: f32 = SCREEN_W * 4.0;
const WORLD_H: f32 = SCREEN_H * 4.0;
const BALL_RADIUS: f32 = 3.0;
const SPAWN_RATE: usize = 5;
const CELL_SIZE: f32 = 64.0;
const RESTITUTION: f32 = 1.01;
const DRAG: f32 = 0.01;
const PAN_SPEED: f32 = 5.0;
const MIN_ZOOM: f32 = 0.5;
const MAX_ZOOM: f32 = 2.0;
const ZOOM_STEP: f32 = 0.1;

fn palette() -> &'static [Color; 8] {
	static COLORS: OnceLock<[Color; 8]> = OnceLock::new();
	COLORS.get_or_init(|| [
		Color::srgb_u8(0xff, 0x6b, 0x6b),
		Color::srgb_u8(0x4e, 0xcd, 0xc4),
		Color::srgb_u8(0x45, 0xb7, 0xd1),
		Color::srgb_u8(0xf9, 0xca, 0x24),
		Color::srgb_u8(0xa2, 0x9b, 0xfe),
		Color::srgb_u8(0xfd, 0x79, 0xa8),
		Color::srgb_u8(0x00, 0xce, 0xc9),
		Color::srgb_u8(0xe1, 0x70, 0x55),
	])
}

thread_local! {
	static RNG: Cell<u64> = const { Cell::new(0x9E3779B97F4A7C15) };
}

fn rand_f32() -> f32 {
	RNG.with(|s| {
		let mut x = s.get();
		x ^= x << 13;
		x ^= x >> 7;
		x ^= x << 17;
		s.set(x);
		(x as u32 as f32) / (u32::MAX as f32)
	})
}

static COLLISION_ENABLED: AtomicBool = AtomicBool::new(true);
static ENTITY_COUNT: AtomicI32 = AtomicI32::new(0);

struct Pending {
	spawns: Vec<Vec2>,
	remove: i32,
	pointer_down: bool,
	pointer_world: Option<Vec2>,
}

fn pending() -> &'static Mutex<Pending> {
	static P: OnceLock<Mutex<Pending>> = OnceLock::new();
	P.get_or_init(|| Mutex::new(Pending {
		spawns: Vec::new(),
		remove: 0,
		pointer_down: false,
		pointer_world: None,
	}))
}

#[derive(Component)]
struct Ball {
	velocity: Vec2,
}

#[derive(Resource)]
struct CircleTexture(Handle<Image>);

fn make_circle_image(size: u32) -> Image {
	let mut data = vec![0u8; (size * size * 4) as usize];
	let r = size as f32 * 0.5;
	let center = r - 0.5;
	for y in 0..size {
		for x in 0..size {
			let dx = x as f32 - center;
			let dy = y as f32 - center;
			let d = (dx * dx + dy * dy).sqrt();
			let alpha = ((r - d).clamp(0.0, 1.0) * 255.0) as u8;
			let i = ((y * size + x) * 4) as usize;
			data[i] = 255;
			data[i + 1] = 255;
			data[i + 2] = 255;
			data[i + 3] = alpha;
		}
	}
	let mut img = Image::new(
		Extent3d { width: size, height: size, depth_or_array_layers: 1 },
		TextureDimension::D2,
		data,
		TextureFormat::Rgba8UnormSrgb,
		RenderAssetUsages::default(),
	);
	img.sampler = ImageSampler::linear();
	img
}

#[wasm_bindgen]
pub fn start(canvas_selector: String, initial_count: u32) {
	console_error_panic_hook::set_once();

	let seed = (js_sys::Math::random() * (u64::MAX as f64)) as u64 | 1;
	RNG.with(|s| s.set(seed));

	{
		let mut p = pending().lock().unwrap();
		p.spawns.reserve(initial_count as usize);
		for _ in 0..initial_count {
			let x = BALL_RADIUS + rand_f32() * (WORLD_W - BALL_RADIUS * 2.0);
			let y = BALL_RADIUS + rand_f32() * (WORLD_H - BALL_RADIUS * 2.0);
			p.spawns.push(Vec2::new(x, y));
		}
	}
	info!("[bevy] start: canvas={} initial_count={}", canvas_selector, initial_count);

	let mut app = App::new();
	app.insert_resource(ClearColor(Color::srgb_u8(0x1a, 0x1a, 0x2e)))
		.add_plugins(
			DefaultPlugins.set(WindowPlugin {
				primary_window: Some(Window {
					canvas: Some(canvas_selector),
					fit_canvas_to_parent: true,
					prevent_default_event_handling: false,
					..default()
				}),
				..default()
			}),
		)
		.add_systems(Startup, setup)
		.add_systems(
			Update,
			(
				drain_pending_spawns,
				drain_pending_removes,
				camera_pan,
				camera_zoom,
				update_pointer_world,
				continuous_spawn,
				integrate_motion,
				bounce_walls,
				collide_balls,
				sync_entity_count,
			)
				.chain(),
		);

	app.run();
}

#[wasm_bindgen]
pub fn set_collision_enabled(enabled: bool) {
	COLLISION_ENABLED.store(enabled, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn get_count() -> u32 {
	ENTITY_COUNT.load(Ordering::Relaxed).max(0) as u32
}

#[wasm_bindgen]
pub fn spawn_at(x: f32, y: f32) {
	pending().lock().unwrap().spawns.push(Vec2::new(x, y));
}

#[wasm_bindgen]
pub fn remove_many(count: u32) {
	pending().lock().unwrap().remove += count as i32;
}

fn setup(mut commands: Commands, mut images: ResMut<Assets<Image>>) {
	let handle = images.add(make_circle_image(32));
	commands.insert_resource(CircleTexture(handle));

	commands.spawn((
		Camera2d,
		Projection::Orthographic(OrthographicProjection {
			scaling_mode: ScalingMode::Fixed { width: SCREEN_W, height: SCREEN_H },
			..OrthographicProjection::default_2d()
		}),
		Transform::from_xyz(SCREEN_W, SCREEN_H, 0.0),
	));
	info!("[bevy] setup: camera spawned at ({}, {})", SCREEN_W, SCREEN_H);
}

fn spawn_ball(commands: &mut Commands, tex: &Handle<Image>, pos: Vec2) {
	let pal = palette();
	let color = pal[(rand_f32() * pal.len() as f32) as usize % pal.len()];
	let vx = (rand_f32() - 0.5) * 400.0;
	let vy = (rand_f32() - 0.5) * 200.0;
	commands.spawn((
		Sprite {
			image: tex.clone(),
			color,
			custom_size: Some(Vec2::splat(BALL_RADIUS * 2.0)),
			..default()
		},
		Transform::from_xyz(pos.x, pos.y, 0.0),
		Ball { velocity: Vec2::new(vx, vy) },
	));
}

fn drain_pending_spawns(mut commands: Commands, circle: Res<CircleTexture>) {
	let spawns = {
		let mut p = pending().lock().unwrap();
		if p.spawns.is_empty() { return; }
		std::mem::take(&mut p.spawns)
	};
	let n = spawns.len();
	for pos in spawns {
		spawn_ball(&mut commands, &circle.0, pos);
	}
	info!("[bevy] spawned {} balls", n);
}

fn drain_pending_removes(
	mut commands: Commands,
	query: Query<Entity, With<Ball>>,
) {
	let count = {
		let mut p = pending().lock().unwrap();
		let c = p.remove;
		p.remove = 0;
		c
	};
	if count <= 0 { return; }
	let to_remove = count as usize;
	let entities: Vec<Entity> = query.iter().collect();
	let start = entities.len().saturating_sub(to_remove);
	for &e in &entities[start..] {
		commands.entity(e).despawn();
	}
}

fn camera_pan(
	keys: Res<ButtonInput<KeyCode>>,
	mut cameras: Query<(&mut Transform, &Projection), With<Camera2d>>,
) {
	let Ok((mut transform, projection)) = cameras.single_mut() else { return; };
	let scale = match projection {
		Projection::Orthographic(o) => o.scale,
		_ => 1.0,
	};
	let speed = PAN_SPEED / scale.max(0.001);
	let up = keys.any_pressed([KeyCode::KeyW, KeyCode::ArrowUp]);
	let down = keys.any_pressed([KeyCode::KeyS, KeyCode::ArrowDown]);
	let left = keys.any_pressed([KeyCode::KeyA, KeyCode::ArrowLeft]);
	let right = keys.any_pressed([KeyCode::KeyD, KeyCode::ArrowRight]);
	let mut dx = 0.0;
	let mut dy = 0.0;
	if up { dy += speed; }
	if down { dy -= speed; }
	if left { dx -= speed; }
	if right { dx += speed; }
	transform.translation.x = (transform.translation.x + dx).clamp(SCREEN_W * 0.5 * scale, WORLD_W - SCREEN_W * 0.5 * scale);
	transform.translation.y = (transform.translation.y + dy).clamp(SCREEN_H * 0.5 * scale, WORLD_H - SCREEN_H * 0.5 * scale);
}

fn camera_zoom(
	scroll: Res<AccumulatedMouseScroll>,
	mut cameras: Query<&mut Projection, With<Camera2d>>,
) {
	let dy = scroll.delta.y;
	if dy == 0.0 { return; }
	let Ok(mut projection) = cameras.single_mut() else { return; };
	if let Projection::Orthographic(o) = projection.as_mut() {
		let zoom = (1.0 / o.scale + dy.signum() * ZOOM_STEP).clamp(MIN_ZOOM, MAX_ZOOM);
		o.scale = 1.0 / zoom;
	}
}

fn update_pointer_world(
	windows: Query<&Window, With<PrimaryWindow>>,
	cameras: Query<(&Camera, &GlobalTransform), With<Camera2d>>,
	mouse: Res<ButtonInput<MouseButton>>,
) {
	let Ok(window) = windows.single() else { return; };
	let Ok((camera, cam_xform)) = cameras.single() else { return; };
	let down = mouse.pressed(MouseButton::Left);
	let world = window
		.cursor_position()
		.and_then(|c| camera.viewport_to_world_2d(cam_xform, c).ok());
	let mut p = pending().lock().unwrap();
	p.pointer_down = down;
	if let Some(w) = world { p.pointer_world = Some(w); }
}

fn continuous_spawn(mut commands: Commands, circle: Res<CircleTexture>) {
	let (down, world) = {
		let p = pending().lock().unwrap();
		(p.pointer_down, p.pointer_world)
	};
	let Some(world) = world else { return; };
	if !down { return; }
	for _ in 0..SPAWN_RATE {
		let jx = (rand_f32() - 0.5) * 40.0;
		let jy = (rand_f32() - 0.5) * 40.0;
		spawn_ball(&mut commands, &circle.0, Vec2::new(world.x + jx, world.y + jy));
	}
}

fn integrate_motion(time: Res<Time>, mut q: Query<(&mut Transform, &mut Ball)>) {
	let dt = time.delta_secs();
	let damping = (1.0 - DRAG * dt).max(0.0);
	for (mut t, mut b) in &mut q {
		b.velocity *= damping;
		t.translation.x += b.velocity.x * dt;
		t.translation.y += b.velocity.y * dt;
	}
}

fn bounce_walls(mut q: Query<(&mut Transform, &mut Ball)>) {
	for (mut t, mut b) in &mut q {
		if t.translation.x < BALL_RADIUS {
			t.translation.x = BALL_RADIUS;
			b.velocity.x = b.velocity.x.abs();
		} else if t.translation.x > WORLD_W - BALL_RADIUS {
			t.translation.x = WORLD_W - BALL_RADIUS;
			b.velocity.x = -b.velocity.x.abs();
		}
		if t.translation.y < BALL_RADIUS {
			t.translation.y = BALL_RADIUS;
			b.velocity.y = b.velocity.y.abs();
		} else if t.translation.y > WORLD_H - BALL_RADIUS {
			t.translation.y = WORLD_H - BALL_RADIUS;
			b.velocity.y = -b.velocity.y.abs();
		}
	}
}

fn collide_balls(mut q: Query<(&mut Transform, &mut Ball)>) {
	if !COLLISION_ENABLED.load(Ordering::Relaxed) { return; }

	let mut data: Vec<(Vec2, Vec2)> = q
		.iter()
		.map(|(t, b)| (t.translation.truncate(), b.velocity))
		.collect();
	if data.len() < 2 { return; }

	let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
	for (i, (pos, _)) in data.iter().enumerate() {
		let cx = (pos.x / CELL_SIZE).floor() as i32;
		let cy = (pos.y / CELL_SIZE).floor() as i32;
		grid.entry((cx, cy)).or_default().push(i);
	}

	let diameter = BALL_RADIUS * 2.0;
	let r2 = diameter * diameter;
	let neighbor_offsets: [(i32, i32); 5] = [(0, 0), (1, 0), (0, 1), (1, 1), (-1, 1)];

	for ((cx, cy), bucket) in &grid {
		for (dx, dy) in neighbor_offsets {
			let Some(other) = grid.get(&(cx + dx, cy + dy)) else { continue; };
			for &i in bucket {
				for &j in other {
					if (dx, dy) == (0, 0) && j <= i { continue; }
					let (pi, vi) = data[i];
					let (pj, vj) = data[j];
					let d = pj - pi;
					let d2 = d.length_squared();
					if d2 >= r2 || d2 <= 0.00001 { continue; }
					let dist = d2.sqrt();
					let nrm = d / dist;
					let overlap = (diameter - dist) * 0.5;
					data[i].0 = pi - nrm * overlap;
					data[j].0 = pj + nrm * overlap;
					let along = (vj - vi).dot(nrm);
					if along < 0.0 {
						let imp = -RESTITUTION * along;
						data[i].1 = vi - nrm * imp;
						data[j].1 = vj + nrm * imp;
					}
				}
			}
		}
	}

	for (i, (mut t, mut b)) in q.iter_mut().enumerate() {
		t.translation.x = data[i].0.x;
		t.translation.y = data[i].0.y;
		b.velocity = data[i].1;
	}
}

fn sync_entity_count(q: Query<&Ball>) {
	ENTITY_COUNT.store(q.iter().count() as i32, Ordering::Relaxed);
}
