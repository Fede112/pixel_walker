# Pixel Walker — Project Context

This document summarizes the current state of the Pixel Walker game for fast onboarding and agent context retrieval. Keep it up to date when changing network events, shared types, or gameplay rules.

## Overview

- Minimal top‑down pixel game with a deterministic, server‑authoritative world.
- Monorepo with a Node.js + Socket.IO server, a Pixi.js + Vite client, and shared TypeScript types.
- Core loop: move around, pick up props, place bridges/walls, simple crafting using a file‑backed item/recipe DB.

## Monorepo Layout

- `game/server/` — Socket.IO + Express server (TypeScript)
  - `src/index.ts` — server entry, world sim, socket handlers
  - `src/database.ts` — item/recipe DB loader & query API
  - `src/data/*.json` — items and recipes (construction, terrain, etc.)
  - `dist/` — build output (may be stale; rebuild with `pnpm -F game/server build`)
- `game/client/` — Browser client (TypeScript, Vite, Pixi.js)
  - `src/index.ts` — main client, rendering + input + networking
  - `src/index.html` — root HTML
  - `src/style.css` — UI styles (pixel HUD, hints)
  - `dist/` — Vite build output
- `game/shared/` — Shared types for strong typing across client/server
  - `types.ts` — canonical shared interfaces and event typings
  - `index.ts` — legacy minimal types (not referenced by current code)
- Root config: `pnpm-workspace.yaml`, `tsconfig.base.json`, `package.json`

## How to Run

- Install: `pnpm install`
- Dev (runs both client and server): `pnpm dev`
  - Server: http://localhost:3000
  - Client (Vite): http://localhost:5173
- Build all: `pnpm build`
- Start (preview builds): `pnpm start`

Notes
- Client dev connects to server at `http://<host>:3000` when `import.meta.env.DEV` is true.
- Server serves the built client from `game/client/dist` in production.

## Client (game/client)

- Tech: TypeScript, Vite, Pixi.js (`pixi.js`), Socket.IO client (`socket.io-client`).
- Rendering:
  - Logical resolution: 192×108, `image-rendering: pixelated` for crisp pixels.
  - Layers: terrain (Graphics), bridges (Container), walls (Container), props (Container), players (Container), UI.
  - Subtle tile highlight under player; placement preview highlight for bridges when holding a plank.
- Input & Movement:
  - Keys: arrows/WASD to move; E to interact; 1/2 to select inventory slots; C to craft.
  - Client simulates movement locally each frame and emits `move(stepX, stepY)`; server corrects via `player:update` when needed.
- Inventory & Crafting:
  - Two slots, client‑side only at the moment. Pickup fills first free slot; using an item clears it locally on success events.
  - Press `C` to craft with the two slots as inputs; emits `craft:request(inputs)` and waits for `craft:result`.
  - On success, both inputs clear and the output is added to a free slot.
- World Interactions:
  - `E` without item: pick up nearest prop within radius.
  - Holding `plank`: `E` places a bridge on the adjacent tile the player faces (water tiles only, no existing bridge).
  - Holding `wall`: `E` places a wall on the current tile (land only).
  - Wall removal: press `E` repeatedly targeting a wall (5 presses within timeout) to remove it.
- Networking:
  - Receives initial `world:init` snapshot and keeps local maps for `props`, `bridges`, `walls`.
  - Handles `player:new/update/remove`, `prop:*`, `bridge:placed`, `wall:placed/removed`.
  - Receives `items:sync` and `items:update` to mirror the server’s item DB.

## Server (game/server)

- Tech: TypeScript, Express static server + Socket.IO realtime. Serves built client in production.
- Config: `WorldConfig = { WORLD_WIDTH: 1200, WORLD_HEIGHT: 800, TILE: 8 }`.
- World State:
  - Grid derived from config. Terrain is a flat `Uint8Array` where 0=land, 1=water.
  - Rivers procedurally generated on boot (Xorshift‑style RNG), props spawned on land.
  - State maps: `props`, `bridges`, `walls` plus tile‑keyed maps for O(1) checks.
  - No persistence yet; world resets on server restart.
- Players:
  - On connect: color assigned, existing players sent, `world:init` and `items:sync` emitted, self `id` sent, then broadcast new player.
  - On disconnect: removed from server and broadcast.
- Movement & Collision (authoritative):
  - Receives `move(deltaX, deltaY)`; applies per‑axis resolution; blocks on water unless a bridge exists and on any wall tile.
- Interactions:
  - `prop:pickup` validates proximity to player before removal.
  - `prop:drop` validates proximity and bounds before creating a new prop.
  - `bridge:place` only on water tiles without an existing bridge.
  - `wall:place` only on land tiles; if placing on the player’s current tile, the server attempts to eject the player to a safe neighbor first.
  - `wall:remove` by tile.
- Crafting & Item DB:
  - `src/database.ts` loads items and recipes from `src/data/*.json` into memory (categories: terrain, transport, construction, food, weapon, tool, fauna).
  - On connect, emits `items:sync` to mirror the DB to the client; can emit `items:update` for deltas.
  - `craft:request(inputs)` validates item IDs and quantities, matches exact recipes by sorted key, and returns first output via `craft:result`.
  - World/inventory are not yet updated on the server; the client clears/assigns slots locally.
- HTTP:
  - Static assets from `game/client/dist`.
  - No REST API endpoints currently (LLM/pixelgen prototypes removed/disabled).

## Shared Types (game/shared/types.ts)

Key interfaces (selected):
- Items: `ItemCategory`, discriminated `Item` union (`TerrainItem | TransportItem | ConstructionItem | FoodItem | WeaponItem | ToolItem | FaunaItem`).
- Game entities: `Player`, `WorldConfig`, `PropType`, `Prop`, `TileItem`, `WorldSnapshot`.
- Socket events:
  - Server → Client: `player:new/update/remove`, `self`, `world:init`, `prop:removed/added`, `bridge:placed`, `wall:placed/removed`, `items:sync/update`, `craft:result`.
  - Client → Server: `move`, `prop:pickup/drop`, `bridge:place`, `wall:place/remove`, `craft:request`.

Note: `game/shared/index.ts` is a minimal legacy variant; current code imports from `shared/types` and should continue to do so.

## Data Files (server)

- Items: defined per category under `game/server/src/data/*.json`.
  - Examples: `construction.json` includes `plank`, `wall`; `transport.json` includes `bridge`; `fauna.json` includes `rock`, `bush`, `flower` (modeled as static fauna for now).
- Recipes: `recipes.json`
  - Examples: `plank_from_bush` (2× bush → 1× plank), `wall_from_rock` (2× rock → 1× wall), `bridge_from_plank` (2× plank → 1× bridge), plus a `test` recipe.

## Message Protocol (Quick Reference)

- Server → Client
  - `self(id: string)`
  - `player:new(player: Player)`
  - `player:update(player: Player)`
  - `player:remove(id: string)`
  - `world:init(snapshot: WorldSnapshot)`
  - `prop:removed({ id, type, by })`
  - `prop:added({ id, type, x, y, by })`
  - `bridge:placed(item: TileItem)`
  - `wall:placed(item: TileItem)`
  - `wall:removed(id: string)`
  - `items:sync(items: Record<string, Item>)`
  - `items:update(items: Record<string, Item>)`
  - `craft:result(success: boolean, result?: { item_id: string; quantity: number })`
- Client → Server
  - `move(deltaX: number, deltaY: number)`
  - `prop:pickup(propId: string)`
  - `prop:drop(type: PropType, x: number, y: number)`
  - `bridge:place(tx: number, ty: number)`
  - `wall:place(tx: number, ty: number)`
  - `wall:remove(tx: number, ty: number)`
  - `craft:request(inputs: { item_id: string; quantity: number }[])`

## Cross‑Cutting Constants (keep in sync)

- World grid: `TILE`, `WORLD_WIDTH`, `WORLD_HEIGHT` — server sends in `world:init`; client respects.
- Collision shape: player base width/height and foot height are duplicated across client/server (`BASE_W=12`, `BASE_H=18`, `FOOT_H=6`, `SPRITE_SCALE=1`). Consider moving to shared config to prevent drift.
- Interact radius: 10 px on both client and server.

## Current Limitations / Observations

- Inventory is client‑side only; server does not track or consume items for placement/crafting. Cheating is possible.
- World state (props/bridges/walls) is in‑memory only; resets on server restart.
- `game/server/dist` may be stale relative to `src` (older build lacks crafting/DB). Always rebuild for production.
- `game/shared/index.ts` appears unused; consider removing or redirecting to `types.ts`.
- No REST APIs; only Socket.IO events.
- No tests; no lints/formatters configured at the workspace level.

## Suggested Next Steps

- Make inventory and crafting server‑authoritative; deduct inputs on success.
- Persist world state (e.g., JSON snapshot or lightweight DB) and add save/load.
- Centralize shared gameplay constants (player size, interact radius) in `game/shared`.
- Add validation and rate limiting for interaction events.
- Add basic test coverage for world rules and recipe matching.
- Consider an admin/dev overlay to visualize server grid and collisions.

## Env & Scripts

- Env: Server reads `PORT` (defaults to 3000). `game/server/.env` currently empty (LLM features removed).
- Scripts
  - Root: `dev`, `build`, `start`, `install:all`
  - Server: `dev` (tsx watch), `build` (tsc), `start` (node dist)
  - Client: `dev` (vite), `build` (vite build), `start` (vite preview)

---
Maintenance tip: When changing socket events or shared types, update this file and `game/shared/types.ts` in the same PR to keep human and machine context aligned.

