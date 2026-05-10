import { describe, expect, test } from "bun:test";
import {
	clearGrid3D,
	createGrid3D,
	getLiveEntry3D,
	gridQueryBox3D,
	gridQueryRadius3D,
	insertEntity3D,
} from "./spatial-hash3D";

describe("spatial-hash3D", () => {
	describe("insertEntity3D / entries", () => {
		test("stores entry with correct position and half-extents", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 5, 10, 15, 2, 3, 4);
			const entry = getLiveEntry3D(grid, 1);
			expect(entry).toBeDefined();
			expect(entry?.entityId).toBe(1);
			expect(entry?.x).toBe(5);
			expect(entry?.y).toBe(10);
			expect(entry?.z).toBe(15);
			expect(entry?.halfW).toBe(2);
			expect(entry?.halfH).toBe(3);
			expect(entry?.halfD).toBe(4);
		});
	});

	describe("gridQueryBox3D", () => {
		test("includes entity fully inside query box", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 5, 5, 5, 1, 1, 1);
			const result : number[] = [];
			gridQueryBox3D(grid, 0, 0, 0, 10, 10, 10, result);
			expect(result.includes(1)).toBe(true);
		});

		test("excludes entity fully outside query box", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 50, 50, 50, 1, 1, 1);
			const result : number[] = [];
			gridQueryBox3D(grid, 0, 0, 0, 10, 10, 10, result);
			expect(result.includes(1)).toBe(false);
		});

		test("includes entity partially overlapping box boundary", () => {
			const grid = createGrid3D(10);
			// Entity centered at (9, 9, 9) with half-extents 2 — spans into [0,10] box
			insertEntity3D(grid, 1, 9, 9, 9, 2, 2, 2);
			const result : number[] = [];
			gridQueryBox3D(grid, 0, 0, 0, 8, 8, 8, result);
			expect(result.includes(1)).toBe(true);
		});

		test("returns multiple entities in overlapping region", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 5, 5, 5, 1, 1, 1);
			insertEntity3D(grid, 2, 6, 6, 6, 1, 1, 1);
			insertEntity3D(grid, 3, 50, 50, 50, 1, 1, 1);
			const result : number[] = [];
			gridQueryBox3D(grid, 0, 0, 0, 10, 10, 10, result);
			expect(result.includes(1)).toBe(true);
			expect(result.includes(2)).toBe(true);
			expect(result.includes(3)).toBe(false);
		});
	});

	describe("gridQueryRadius3D", () => {
		test("includes entity within radius", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 5, 5, 5, 1, 1, 1);
			const result : number[] = [];
			gridQueryRadius3D(grid, 5, 5, 5, 10, result);
			expect(result.includes(1)).toBe(true);
		});

		test("excludes entity beyond radius", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 50, 50, 50, 1, 1, 1);
			const result : number[] = [];
			gridQueryRadius3D(grid, 0, 0, 0, 5, result);
			expect(result.includes(1)).toBe(false);
		});

		test("uses AABB-to-point distance (entity touching sphere boundary)", () => {
			const grid = createGrid3D(10);
			// Entity AABB: [8,12] x [0,10] x [0,10] — closest point to origin is (8,0,0), distance = 8
			insertEntity3D(grid, 1, 10, 5, 5, 2, 5, 5);
			const result : number[] = [];
			gridQueryRadius3D(grid, 0, 5, 5, 8, result);
			expect(result.includes(1)).toBe(true);
		});

		test("excludes entity just outside sphere via AABB distance", () => {
			const grid = createGrid3D(10);
			// Entity AABB closest point to origin is (9,0,0), distance = 9 > radius 8
			insertEntity3D(grid, 1, 11, 5, 5, 2, 5, 5);
			const result : number[] = [];
			gridQueryRadius3D(grid, 0, 5, 5, 8, result);
			expect(result.includes(1)).toBe(false);
		});
	});

	describe("clearGrid3D entry recycling", () => {
		test("reuses the same entry object across rebuilds", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 5, 5, 5, 1, 1, 1);
			const entryBefore = getLiveEntry3D(grid, 1);

			clearGrid3D(grid);
			insertEntity3D(grid, 1, 6, 7, 8, 2, 2, 2);
			const entryAfter = getLiveEntry3D(grid, 1);

			// Same object reference — no allocation
			expect(entryAfter).toBe(entryBefore);
			// Updated in place
			expect(entryAfter?.x).toBe(6);
			expect(entryAfter?.y).toBe(7);
			expect(entryAfter?.z).toBe(8);
		});

		test("clears cell buckets between rebuilds", () => {
			const grid = createGrid3D(10);
			insertEntity3D(grid, 1, 5, 5, 5, 1, 1, 1);
			clearGrid3D(grid);
			// No inserts after clear — grid should return nothing
			const result : number[] = [];
			gridQueryBox3D(grid, 0, 0, 0, 10, 10, 10, result);
			expect(result.length).toBe(0);
		});
	});

	describe("multi-cell spanning", () => {
		test("large entity appears in multiple cells and is found from any of them", () => {
			const grid = createGrid3D(10);
			// halfW/H/D = 15 means this spans 3 cells in each axis
			insertEntity3D(grid, 1, 0, 0, 0, 15, 15, 15);

			// Query a cell far from center but still within the entity's span
			const result1 : number[] = [];
			gridQueryBox3D(grid, 12, 12, 12, 14, 14, 14, result1);
			expect(result1.includes(1)).toBe(true);

			// Query from the other side
			const result2 : number[] = [];
			gridQueryBox3D(grid, -14, -14, -14, -12, -12, -12, result2);
			expect(result2.includes(1)).toBe(true);
		});
	});
});
