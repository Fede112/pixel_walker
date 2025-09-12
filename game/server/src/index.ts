import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import {
  Player,
  ServerToClientEvents,
  ClientToServerEvents,
  WorldConfig,
  WorldSnapshot,
  Prop,
  TileItem,
  PropType,
} from 'shared/types';
import { initializeDatabase, getDatabase } from './database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
const dataPath = path.join(__dirname, 'data');
initializeDatabase(dataPath);
const db = getDatabase();

const CONFIG: WorldConfig = {
  WORLD_WIDTH: 1200,
  WORLD_HEIGHT: 800,
  TILE: 8,
};

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' }
});

// Enable JSON body parsing for API routes
app.use(express.json());

// Serve static files from the client/dist directory
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// ----- Authoritative world state -----
const GRID_W = Math.ceil(CONFIG.WORLD_WIDTH / CONFIG.TILE);
const GRID_H = Math.ceil(CONFIG.WORLD_HEIGHT / CONFIG.TILE);
const INTERACT_RADIUS = 10; // pixels
const BASE_W = 12; // must mirror client character width
const BASE_H = 18; // client character height
const SPRITE_SCALE = 1; // keep in sync with client
const FOOT_H = 6; // collision height near feet (same as client)

// terrain: 0 land, 1 water
const terrain = new Uint8Array(GRID_W * GRID_H);

const props = new Map<string, Prop>();
const bridges = new Map<string, TileItem>();
const walls = new Map<string, TileItem>();

const bridgeByTile = new Map<string, string>();
const wallByTile = new Map<string, string>();

function key(tx: number, ty: number) { return `${tx},${ty}`; }

let idSeq = 1;
function genId(prefix: string) { return `${prefix}${idSeq++}`; }

let worldSeed = 2025;
function wrand() {
  worldSeed ^= worldSeed << 13; worldSeed ^= worldSeed >>> 17; worldSeed ^= worldSeed << 5;
  return ((worldSeed >>> 0) / 4294967296);
}

function tIndex(tx: number, ty: number) { return ty * GRID_W + tx; }

function worldToTile(x: number, y: number) {
  return {
    tx: Math.max(0, Math.min(GRID_W - 1, Math.floor(x / CONFIG.TILE))),
    ty: Math.max(0, Math.min(GRID_H - 1, Math.floor(y / CONFIG.TILE)))
  };
}

function hasBridgeAtTile(tx: number, ty: number) {
  // Fast check via tile-key map
  return bridgeByTile.has(`${tx},${ty}`);
}

function hasWallAtTile(tx: number, ty: number) {
  return wallByTile.has(`${tx},${ty}`);
}

function rectOverlapsWall(x: number, y: number) {
  const width = BASE_W * SPRITE_SCALE;
  const halfW = width / 2;
  const x1 = Math.floor((x - halfW) / CONFIG.TILE);
  const y1 = Math.floor((y - FOOT_H) / CONFIG.TILE);
  const x2 = Math.floor((x + halfW - 1) / CONFIG.TILE);
  const y2 = Math.floor((y - 1) / CONFIG.TILE);
  const minTX = Math.max(0, x1);
  const minTY = Math.max(0, y1);
  const maxTX = Math.min(GRID_W - 1, x2);
  const maxTY = Math.min(GRID_H - 1, y2);
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (hasWallAtTile(tx, ty)) return true;
    }
  }
  return false;
}

function isWaterAt(x: number, y: number) {
  const { tx, ty } = worldToTile(x, y);
  return terrain[tIndex(tx, ty)] === 1;
}

function isWalkableAt(x: number, y: number) {
  if (rectOverlapsWall(x, y)) return false;
  const { tx, ty } = worldToTile(x, y);
  // Water must have a bridge to be walkable
  const water = terrain[tIndex(tx, ty)] === 1;
  if (water && !hasBridgeAtTile(tx, ty)) return false;
  return true;
}

function generateRivers() {
  terrain.fill(0);
  const rivers = 2 + Math.floor(wrand() * 2);
  for (let r = 0; r < rivers; r++) {
    let y = Math.floor(wrand() * GRID_H);
    let width = 2 + Math.floor(wrand() * 2);
    for (let x = 0; x < GRID_W; x++) {
      y += (wrand() - 0.5) * 1.3;
      if (y < 1) y = 1;
      if (y > GRID_H - 2) y = GRID_H - 2;
      const cy = Math.round(y);
      for (let wy = -width; wy <= width; wy++) {
        const ty = cy + wy;
        if (ty < 0 || ty >= GRID_H) continue;
        terrain[tIndex(x, ty)] = 1;
      }
    }
  }
}

type PropRec = Prop;
function generateProps(count: number) {
  let seed = 1337;
  function rand() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); }
  let plankCount = 0;
  for (let i = 0; i < count; i++) {
    const r = rand();
    let x = 0, y = 0;
    for (let tries = 0; tries < 25; tries++) {
      x = Math.floor(rand() * (CONFIG.WORLD_WIDTH - 8)) + 4;
      y = Math.floor(rand() * (CONFIG.WORLD_HEIGHT - 8)) + 4;
      const tx = Math.max(0, Math.min(GRID_W - 1, Math.floor(x / CONFIG.TILE)));
      const ty = Math.max(0, Math.min(GRID_H - 1, Math.floor(y / CONFIG.TILE)));
      if (terrain[tIndex(tx, ty)] === 0) break; // land only
    }
    let type: PropType = r < 0.25 ? 'rock' : r < 0.50 ? 'bush' : r < 0.70 ? 'flower' : r < 0.90 ? 'plank' : r < 0.94 ? 'wall' : 'pebble';
    if (type === 'plank') plankCount++;
    const id = genId('p');
    props.set(id, { id, x, y, type });
  }
  const MIN_PLANKS = 30;
  if (plankCount < MIN_PLANKS) {
    for (const p of props.values()) {
      if (plankCount >= MIN_PLANKS) break;
      if (p.type === 'bush' || p.type === 'pebble' || p.type === 'flower') { p.type = 'plank'; plankCount++; }
    }
  }
}

function buildSnapshot(): WorldSnapshot {
  return {
    config: CONFIG,
    gridW: GRID_W,
    gridH: GRID_H,
    terrain: Array.from(terrain),
    props: Array.from(props.values()),
    bridges: Array.from(bridges.values()),
    walls: Array.from(walls.values()),
  };
}

function distance2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy;
}

// Initialize world once
generateRivers();
generateProps(420);

const players: Record<string, Player> = {};

io.on('connection', (socket) => {
  console.log(`Player ${socket.id} connected`);
  const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;

  // Send existing players to new client
  for (const player of Object.values(players)) {
    socket.emit('player:new', player);
  }
  // Send world snapshot to new client
  socket.emit('world:init', buildSnapshot());
  
  // Send item database to new client
  socket.emit('items:sync', db.getAllItems());

  // Create new player - spawn at center of world (pixel coordinates)
  const startX = Math.floor(CONFIG.WORLD_WIDTH / 2);
  const startY = Math.floor(CONFIG.WORLD_HEIGHT / 2);
  const newPlayer: Player = { 
    id: socket.id, 
    x: startX, 
    y: startY, 
    color 
  };
  
  // Add to players list
  players[socket.id] = newPlayer;
  
  // Tell the new client who they are
  socket.emit('self', socket.id);
  
  // Broadcast new player to ALL clients (including the new one)
  io.emit('player:new', newPlayer);
  
  console.log(`Player ${socket.id} spawned at (${startX}, ${startY}) with color ${color}`);

  socket.on('move', (deltaX, deltaY) => {
    const player = players[socket.id];
    if (!player) return;

    // Apply movement with server-side collision (authoritative)
    // Per-axis resolution to match client behavior
    const tryX = Math.max(0.1, Math.min(CONFIG.WORLD_WIDTH - 0.1, player.x + deltaX));
    if (isWalkableAt(tryX, player.y)) player.x = tryX;
    const tryY = Math.max(0.1, Math.min(CONFIG.WORLD_HEIGHT - 0.1, player.y + deltaY));
    if (isWalkableAt(player.x, tryY)) player.y = tryY;
    
    io.emit('player:update', player);
  });

  // ----- World actions -----
  socket.on('prop:pickup', (propId: string) => {
    const player = players[socket.id]; if (!player) return;
    const p = props.get(propId); if (!p) return;
    if (distance2(player.x, player.y, p.x, p.y) > INTERACT_RADIUS * INTERACT_RADIUS) return;
    props.delete(propId);
    io.emit('prop:removed', { id: propId, type: p.type, by: socket.id });
  });

  socket.on('bridge:place', (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return;
    const idKey = key(tx, ty);
    if (bridgeByTile.has(idKey)) return;
    if (terrain[tIndex(tx, ty)] !== 1) return; // only on water
    const id = genId('b');
    const item: TileItem = { id, tx, ty, by: socket.id };
    bridges.set(id, item); bridgeByTile.set(idKey, id);
    io.emit('bridge:placed', item);
  });

  socket.on('wall:place', (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return;
    const idKey = key(tx, ty);
    if (wallByTile.has(idKey)) return;
    if (terrain[tIndex(tx, ty)] !== 0) return; // only on land
    // Eject placing player if they are currently on this tile to avoid trapping
    const pl = players[socket.id];
    if (pl) {
      const here = worldToTile(pl.x, pl.y);
      if (here.tx === tx && here.ty === ty) {
        // Try to move the player to a safe neighboring tile before placing the wall
        const dirs = [ {dx:0,dy:-1}, {dx:0,dy:1}, {dx:-1,dy:0}, {dx:1,dy:0} ]; // up, down, left, right
        let moved = false;
        for (const d of dirs) {
          const ntx = tx + d.dx; const nty = ty + d.dy;
          if (ntx < 0 || nty < 0 || ntx >= GRID_W || nty >= GRID_H) continue;
          const cx = ntx * CONFIG.TILE + CONFIG.TILE / 2;
          const cy = (nty + 1) * CONFIG.TILE; // feet center (tile bottom)
          if (isWalkableAt(cx, cy)) { pl.x = cx; pl.y = cy; moved = true; break; }
        }
        if (!moved) return; // do not place if we cannot safely eject
        io.emit('player:update', pl);
      }
    }
    const id = genId('w');
    const item: TileItem = { id, tx, ty, by: socket.id };
    walls.set(id, item); wallByTile.set(idKey, id);
    io.emit('wall:placed', item);
  });

  socket.on('wall:remove', (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return;
    const idKey = key(tx, ty);
    const id = wallByTile.get(idKey); if (!id) return;
    walls.delete(id); wallByTile.delete(idKey);
    io.emit('wall:removed', id);
  });

  socket.on('prop:drop', (type: PropType, x: number, y: number) => {
    // Basic validation: near player and inside world
    const player = players[socket.id]; if (!player) return;
    if (x < 0 || y < 0 || x > CONFIG.WORLD_WIDTH || y > CONFIG.WORLD_HEIGHT) return;
    if (distance2(player.x, player.y, x, y) > INTERACT_RADIUS * INTERACT_RADIUS * 4) return;
    const id = genId('p');
    const p: Prop = { id, x: Math.round(x), y: Math.round(y), type };
    props.set(id, p);
    io.emit('prop:added', { id, type, x: p.x, y: p.y, by: socket.id });
  });

  // Crafting system
  socket.on('craft:request', (inputs: { item_id: string; quantity: number }[]) => {
    console.log(`Player ${socket.id} requesting craft with inputs:`, inputs);
    
    // Validate inputs exist in database
    if (!db.validateCraftingInputs(inputs)) {
      socket.emit('craft:result', false);
      return;
    }
    
    // Find matching recipe
    const recipe = db.findRecipeByInputs(inputs);
    if (!recipe) {
      console.log(`No recipe found for inputs:`, inputs);
      socket.emit('craft:result', false);
      return;
    }
    
    console.log(`Found recipe: ${recipe.name}`);
    
    // For now, assume crafting always succeeds and returns first output
    const output = recipe.outputs[0];
    if (output) {
      socket.emit('craft:result', true, output);
    } else {
      socket.emit('craft:result', false);
    }
  });


  socket.on('disconnect', () => {
    console.log(`Player ${socket.id} disconnected`);
    delete players[socket.id];
    io.emit('player:remove', socket.id);
  });
});

// API routes (none for now; pixelgen disabled)

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
