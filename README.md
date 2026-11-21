# sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/lusiana27/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/lusiana27/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for make.fun's bounty: it answers every level of a set in as few pushes as possible.

## How it works

Every level the generator draws is a one-square hallway with 1–4 rooms off it, each room holding 3–4 boxes on its own goals — and a box pushed out of a room through its door can never be pushed back. So the rooms are independent problems joined only by the player's walk, and the level's push-optimum P* is the sum of the rooms' optima.

The solver cuts the level into rooms (the hallway row's dead squares are the cut), then solves each room push-optimally with a breadth-first search over pushes — the first solved state found is push-optimal — pruning two deadlocks that can never be undone: a box on a dead square (one from which no push can ever reach a goal) and a box frozen in a 2×2 block of walls and boxes. A state is its boxes plus the player's reachable region, named by its lowest square. The search budgets by states expanded, never by the clock, so two runs write the same bytes. If a level does not split into rooms, or a room search gives up, it falls back to the same push search over the whole level, and finally to an empty (valid) answer rather than an illegal move.

## Run it

```sh
node main.ts
```

It reads `/input/<id>/level.txt` for each instance and writes `/output/<id>/solution.txt` (moves in LURD, one letter a step). Local test: `mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts`, then score with the kit's scorer.

## Results on the practice set

| Instance | Rooms | P* | Pushes | Points |
| --- | --- | --- | --- | --- |
| i001 | 1 × 3 boxes | 13 | 13 | 1,000 |
| i002 | 1 × 4 boxes | 16 | 16 | 1,000 |
| i003 | 2 × 4 boxes | 29 | 29 | 1,000 |
| i004 | 3 × 4 boxes | 47 | 47 | 1,000 |
| i005 | 4 × 4 boxes | 60 | 60 | 1,000 |

**Practice score: 1,000,000 / 1,000,000** — every level solved in exactly P* pushes. The house baseline (plain-astar 1.0.0) scores 200,000 on the same set: it solves only i001 and gives up on the other four.

---

<sub>Entered on [make.fun](https://make.fun/?ref=j11vkafs&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
