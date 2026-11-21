// sokoban-solver-01-run-20261121: a push-optimal Sokoban solver.
//
// Idea (from the competition's own description of the levels): every level is a
// one-square hallway with 1-4 rooms off it, each room holding 3-4 boxes on its
// own goals, and a box pushed out of a room through its door can never be pushed
// back — so the rooms are independent problems joined only by the player's walk,
// and the level's push-optimum P* is the sum of the rooms' optima.
//
// So this solver:
//   1. cuts the level into rooms (the hallway row's dead squares are the cut),
//   2. solves each room push-optimally with a breadth-first search over pushes
//      (first solved state found is push-optimal), pruning two deadlocks that
//      can never be undone — a box on a dead square, and a box frozen in a 2x2
//      block of walls and boxes — and
//   3. stitches the rooms' move strings together (the player walks on from
//      wherever the previous room left it).
// A state is (sorted box squares, the player's reachable region, named by its
// lowest square): two states with the same boxes and the same region offer the
// same future pushes, whatever square the player stands on. The search budgets
// by states expanded, never by the clock, so two runs write the same bytes.
// If a level does not split into rooms, or a room search gives up, the solver
// falls back to the same push search over the whole level, and finally to an
// empty (valid, worthless) answer rather than an illegal move.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

interface Dir { dx: number; dy: number; step: string; push: string }
const DIRS: Dir[] = [
  { dx: 0, dy: -1, step: 'u', push: 'U' },
  { dx: 0, dy: 1, step: 'd', push: 'D' },
  { dx: -1, dy: 0, step: 'l', push: 'L' },
  { dx: 1, dy: 0, step: 'r', push: 'R' },
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

interface Result { pushes: number; moves: string }

/** Work budget, counted in states created, never in seconds (two runs must agree). */
interface Work { used: number; limit: number }
const ROOM_STATE_CAP = 400_000;
const WHOLE_STATE_CAP = 800_000;
const GLOBAL_STATE_CAP = 5_000_000;

/** XSB text (# wall, space floor, . goal, $ box, * box on goal, @ player, + player on goal). */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outer frame is wall whatever it shows: nothing leaves the board, so a
  // floor square's four neighbours are always in bounds.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return {
    w, h, wall,
    goals: goals.sort((a, b) => a - b),
    boxes: boxes.sort((a, b) => a - b),
    player,
  };
}

/**
 * The squares from which a box alone can be pushed onto some goal: pull the
 * box back from the goals, one square at a time, ignoring the other boxes.
 * A square the pull never reaches is dead: a box there is lost for good, so
 * pruning it can never throw away a solvable state (the pull is an
 * over-approximation — it only ever marks more squares live, never fewer).
 */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (let k = 0; k < 4; k++) {
      const d = DIRS[k].dy * w + DIRS[k].dx;
      const y = x - d;
      // A box on y can be pushed in direction d onto the live square x, when
      // the player can stand on y - d to make that push.
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Flood-fill from `from` around walls and the boxes in `occupied`, marking
 * every square reached in `seen` with `stamp`; returns the lowest square of
 * the region (the region's name: two states with the same boxes and the same
 * region offer the same pushes, whatever square the player stands on).
 */
function floodLow(
  w: number, wall: Uint8Array, occupied: Uint8Array,
  from: number, seen: Int32Array, stamp: number, stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    const q0 = p - w;
    const q1 = p + w;
    const q2 = p - 1;
    const q3 = p + 1;
    if (wall[q0] === 0 && occupied[q0] === 0 && seen[q0] !== stamp) { seen[q0] = stamp; stack[n++] = q0; }
    if (wall[q1] === 0 && occupied[q1] === 0 && seen[q1] !== stamp) { seen[q1] = stamp; stack[n++] = q1; }
    if (wall[q2] === 0 && occupied[q2] === 0 && seen[q2] !== stamp) { seen[q2] = stamp; stack[n++] = q2; }
    if (wall[q3] === 0 && occupied[q3] === 0 && seen[q3] !== stamp) { seen[q3] = stamp; stack[n++] = q3; }
  }
  return low;
}

/**
 * Whether the box just pushed to `t` sits in a frozen 2x2 block: four squares
 * of walls and boxes, one of the boxes off its goal. No box in such a block
 * can ever move again (every push destination lies inside the block and is
 * taken, or is a wall), so the off-goal box in it is stuck for good and the
 * state is dead.
 */
function frozenBlock(
  w: number, wall: Uint8Array, occupied: Uint8Array, goal: Uint8Array, t: number,
): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) ||
        (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, lower LURD letters. */
function walkTo(
  w: number, wall: Uint8Array, occupied: Uint8Array, from: number, to: number,
): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue: number[] = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (let k = 0; k < 4; k++) {
      const q = p + DIRS[k].dy * w + DIRS[k].dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = DIRS[k].step;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** The square the player stands on after `moves` (LURD, case aside) from `from`. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/**
 * Breadth-first search over pushes, in order of pushes made: the first solved
 * state found is push-optimal. A state is its boxes (sorted) and its player's
 * region (named by its lowest square). Dead squares and frozen 2x2 blocks are
 * pruned. Returns null when the search gives up (state cap) or the level has
 * no solution. Pure: no clock, no randomness, ties by square order.
 */
function solvePushBFS(level: Level, maxStates: number, work: Work): Result | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(w, wall, goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goal[b]);
  if (level.boxes.some((b) => !live[b])) return null;
  if (solved(level.boxes)) return { pushes: 0, moves: '' };

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  // The key flood runs on its own marks: it must not overwrite the current
  // state's region marks, which the push-square checks still need below.
  const seenKey = new Int32Array(size);
  let stampKey = 0;
  const stack = new Int32Array(size);
  let stamp = 0;

  // A state's key: region-low, then the boxes. Numeric while it fits in a
  // safe integer (rooms: at most 4 boxes on a board of at most 255 squares);
  // a string otherwise (the whole-level fallback with many boxes).
  const numericKeys = level.boxes.length <= 4 && size <= 255;
  const keyOf = (bs: number[], low: number): number | string => {
    if (numericKeys) {
      let k = low;
      for (const b of bs) k = k * size + b;
      return k;
    }
    return low + '|' + bs.join(',');
  };

  // The states in the order found: their boxes, the player's square after the
  // push that made them, and the push that made them from their parent.
  const boxesList: number[][] = [level.boxes.slice()];
  const playerList: number[] = [level.player];
  const parent: number[] = [-1];
  const pushFrom: number[] = [-1];
  const pushDir: number[] = [-1];
  const index = new Map<number | string, number>();
  for (const b of level.boxes) occupied[b] = 1;
  const startLow = floodLow(w, wall, occupied, level.player, seen, ++stamp, stack);
  index.set(keyOf(level.boxes, startLow), 0);
  for (const b of level.boxes) occupied[b] = 0;

  let found = -1;
  for (let head = 0; found < 0 && head < boxesList.length; head++) {
    const boxes = boxesList[head];
    for (const b of boxes) occupied[b] = 1;
    floodLow(w, wall, occupied, playerList[head], seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi];
      for (let k = 0; k < 4; k++) {
        const d = DIRS[k].dy * w + DIRS[k].dx;
        const t = b + d;
        if (wall[t] || occupied[t] || !live[t]) continue;
        if (seen[b - d] !== here) continue; // the player cannot reach the push square
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(w, wall, occupied, goal, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = keyOf(next, floodLow(w, wall, occupied, b, seenKey, ++stampKey, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (boxesList.length >= maxStates || work.used >= work.limit) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        work.used++;
        index.set(key, boxesList.length);
        boxesList.push(next!);
        playerList.push(b);
        parent.push(head);
        pushFrom.push(b);
        pushDir.push(k);
        if (solved(next!)) {
          found = boxesList.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;

  // The path of states, then the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = boxesList[s];
    const from = boxes.find((b) => !nextBoxes.includes(b))!;
    const to = nextBoxes.find((b) => !boxes.includes(b))!;
    const k = pushDir[s];
    const d = DIRS[k].dy * w + DIRS[k].dx;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(w, wall, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += DIRS[k].push;
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done?: boolean;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor, and each part left that
 * holds a box is a room. Null when some part holds more or fewer boxes than
 * goals, or a box starts in the hallway: then the level is no set of rooms.
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares: number[] = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (let k = 0; k < 4; k++) {
        const q = squares[i] + DIRS[k].dy * w + DIRS[k].dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) {
    if (part[b] < 0) return null;
    rooms[part[b]].boxes.push(b);
  }
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/**
 * The level solved room by room: each room's push-optimal solution in turn,
 * the other rooms' boxes standing as walls (on their goals once their room is
 * done), the player walking on from where the last room left it. A box never
 * leaves its room, so the rooms' optima add up to the level's. Null when a
 * room's search gives up, or the level is no set of rooms.
 */
function solveByRooms(level: Level, work: Work): Result | null {
  const rooms = roomsOf(level);
  if (rooms === null) return null;
  let player = level.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      const src = other.done ? other.goals : other.boxes;
      for (const b of src) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solvePushBFS(sub, ROOM_STATE_CAP, work);
    if (solved === null) return null;
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return { pushes, moves };
}

/** One level's moves: room by room, else the whole level, else nothing (valid, 0 points). */
function solveLevel(text: string, work: Work): string {
  const level = parseLevel(text);
  if (level.boxes.every((b) => level.goals.includes(b))) return '';
  let solved = solveByRooms(level, work);
  if (solved === null) solved = solvePushBFS(level, WHOLE_STATE_CAP, work);
  return solved === null ? '' : solved.moves;
}

const work: Work = { used: 0, limit: GLOBAL_STATE_CAP };
for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'), work);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
