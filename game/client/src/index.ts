import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
import type { Player, WorldSnapshot, Prop as SProp, TileItem, PropType, WorldConfig } from 'shared/types';
import './reset.css';
import './style.css';

// ===== Logical viewport (crisp) =====
const LOGICAL_WIDTH = 192;
const LOGICAL_HEIGHT = 108;
const SPRITE_SCALE = 1;
const INTERACT_RADIUS = 10;
const PLACE_RADIUS = INTERACT_RADIUS * 2;
const PROP_PLACE_RADIUS = INTERACT_RADIUS * 4; // free props (double tile range)
const CLICK_SELECT_RADIUS = 10; // radius around mouse to select/hover a prop

const canvas = document.getElementById('game') as HTMLCanvasElement;
// Resize CSS size but keep logical pixel buffer
function resize() {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / LOGICAL_WIDTH, window.innerHeight / LOGICAL_HEIGHT)));
  canvas.style.width = `${LOGICAL_WIDTH * scale}px`;
  canvas.style.height = `${LOGICAL_HEIGHT * scale}px`;
}
window.addEventListener('resize', resize); resize();

// ===== Pixi setup =====
const app = new PIXI.Application({
  view: canvas,
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  antialias: false,
  backgroundColor: 0xffffff,
  resolution: 1,
});
// Cap render loop to 60 FPS to avoid 120/144Hz spikes
// (movement/physics remain independent of render rate)
// @ts-ignore pixi typing
app.ticker.maxFPS = 60;

const worldContainer = new PIXI.Container();
app.stage.addChild(worldContainer);

// Layers
const terrainLayer = new PIXI.Graphics();
const bridgesLayer = new PIXI.Container(); // id -> graphics
const wallsLayer = new PIXI.Container(); // id -> graphics
const propsLayer = new PIXI.Container(); // id -> graphics
const playersLayer = new PIXI.Container();
const uiContainer = new PIXI.Container();
// Placement previews/highlights (world-space)
const tileHighlight = new PIXI.Graphics(); // generic tile highlight box
tileHighlight.visible = false;
const bridgeTargetHighlight = new PIXI.Graphics(); // colored bridge target
bridgeTargetHighlight.visible = false;
const propPlacementPreview = new PIXI.Graphics(); // ghosted free-prop preview
propPlacementPreview.visible = false;
const propPlacementOutline = new PIXI.Graphics(); // valid/invalid ring for free-prop placement
propPlacementOutline.visible = false;
const propPickupHighlight = new PIXI.Graphics(); // highlight nearest prop within range
propPickupHighlight.visible = false;

worldContainer.addChild(
  terrainLayer,
  bridgesLayer,
  wallsLayer,
  propsLayer,
  playersLayer,
  tileHighlight,
  bridgeTargetHighlight,
  propPlacementPreview,
  propPlacementOutline,
  propPickupHighlight,
);
app.stage.addChild(uiContainer);

// ===== Socket.io =====
const SERVER_URL = (import.meta as any).env?.DEV ? `${window.location.protocol}//${window.location.hostname}:3000` : undefined;
const socket = io(SERVER_URL);
let selfId: string | null = null;
socket.on('self', (id) => selfId = id);

// State from server
let CONFIG: WorldConfig = { WORLD_WIDTH: 1200, WORLD_HEIGHT: 800, TILE: 8 };
let GRID_W = Math.ceil(CONFIG.WORLD_WIDTH / CONFIG.TILE);
let GRID_H = Math.ceil(CONFIG.WORLD_HEIGHT / CONFIG.TILE);
let terrain: Uint8Array = new Uint8Array(0);
const props = new Map<string, SProp>();
const propSprites = new Map<string, PIXI.Graphics>();
const bridges = new Map<string, TileItem>();
const walls = new Map<string, TileItem>();

// Fast lookup indices (client-side)
const bridgeByTile = new Map<string, string>(); // key tx,ty -> id
const wallByTile = new Map<string, string>();   // key tx,ty -> id
const propsByTile = new Map<string, Set<string>>(); // key tx,ty -> set of prop ids

// Item database synced from server
const itemDatabase = new Map<string, any>(); // Store items from server

type RemoteEntity = { sprite: PIXI.Sprite; textures: [PIXI.Texture, PIXI.Texture, PIXI.Texture]; color: string; stepTime: number; stepIndex: number; lastX: number; lastY: number };
const remotes = new Map<string, RemoteEntity>();

// Player local
type Facing = 'up' | 'down' | 'left' | 'right';
const BASE_W = 12; const BASE_H = 18;
const player = { x: 100, y: 100, speed: 60, width: BASE_W * SPRITE_SCALE, height: BASE_H * SPRITE_SCALE, face: 'down' as Facing, stepTime: 0, stepIndex: 0, color: '#111111' };
let selfSprite: PIXI.Sprite | null = null;
let selfTextures: [PIXI.Texture, PIXI.Texture, PIXI.Texture] | null = null;

// Inventory (client-side only)
type InvProp = { id?: string; type: PropType };
const inventory: (InvProp | null)[] = [null, null];
let activeSlot = 0;

// Keys (WASD movement only)
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') { e.preventDefault(); keys.add(k); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') keys.delete(k);
});

// Mouse tracking (world-space)
let mouse = { x: 0, y: 0, worldX: 0, worldY: 0, inside: false };
let mouseDirty = false;
function updateMouseFromEvent(e: MouseEvent) {
  // Compute logical coords from offset within the canvas to avoid layout thrash
  const cssW = parseFloat(canvas.style.width) || canvas.clientWidth || LOGICAL_WIDTH;
  const cssH = parseFloat(canvas.style.height) || canvas.clientHeight || LOGICAL_HEIGHT;
  const scaleX = LOGICAL_WIDTH / cssW;
  const scaleY = LOGICAL_HEIGHT / cssH;
  const sx = (e.offsetX ?? 0) * scaleX;
  const sy = (e.offsetY ?? 0) * scaleY;
  mouse.x = sx; mouse.y = sy;
  mouse.worldX = sx - worldContainer.x;
  mouse.worldY = sy - worldContainer.y;
}
canvas.addEventListener('mousemove', (e) => { mouse.inside = true; updateMouseFromEvent(e); mouseDirty = true; });
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });
// Prevent native context menu and use right-click for pickup
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // left click only
  e.preventDefault();
  const it = inventory[activeSlot];
  if (!it) {
    // No item selected -> try pickup with mouse
    tryPickupWithMouse();
    return;
  }
  // Tile items: wall and plank (bridge)
  if (it.type === 'wall') {
    const { tx, ty } = worldToTile({ x: mouse.worldX, y: mouse.worldY });
    const x = tx * CONFIG.TILE, y = ty * CONFIG.TILE;
    const cx = x + CONFIG.TILE / 2, cy = y + CONFIG.TILE / 2;
    const inRange = ((cx - player.x) ** 2 + (cy - player.y) ** 2) <= (PLACE_RADIUS * PLACE_RADIUS);
    const isLand = terrain[tIndex(tx, ty)] === 0;
    const exists = wallByTile.has(tileKey(tx, ty));
    if (!inRange || !isLand || exists) return;
    flushPendingMove();
    socket.emit('wall:place', tx, ty);
    return;
  }
  if (it.type === 'plank') {
    const { tx, ty } = worldToTile({ x: mouse.worldX, y: mouse.worldY });
    const x = tx * CONFIG.TILE, y = ty * CONFIG.TILE;
    const cx = x + CONFIG.TILE / 2, cy = y + CONFIG.TILE / 2;
    const inRange = ((cx - player.x) ** 2 + (cy - player.y) ** 2) <= (PLACE_RADIUS * PLACE_RADIUS);
    const isWater = terrain[tIndex(tx, ty)] === 1;
    const exists = bridgeByTile.has(tileKey(tx, ty));
    if (!inRange || !isWater || exists) return;
    flushPendingMove();
    socket.emit('bridge:place', tx, ty);
    return;
  }
  // Free props: drop at mouse world position
  const px = Math.round(mouse.worldX), py = Math.round(mouse.worldY);
  const inRange = ((px - player.x) ** 2 + (py - player.y) ** 2) <= (PROP_PLACE_RADIUS * PROP_PLACE_RADIUS);
  if (!inRange) return;
  flushPendingMove();
  socket.emit('prop:drop', it.type, px, py);
});

// Right-click: deselect any inventory slot
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 2) return;
  e.preventDefault();
  if (activeSlot !== -1) { activeSlot = -1 as any; renderHUD(); }
});

// Interact keys
window.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); interact(); }
  if (e.key === '1') activeSlot = 0;
  if (e.key === '2') activeSlot = 1;
  if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (tryCraft()) renderHUD(); }
});

function interact() {
  // E -> grab nearest or trigger wall removal presses
  // Try remove wall first (press sequence)
  if (tryWallRemovalPress()) return;
  // Else try pickup nearest prop (by id)
  const nearest = nearestProp(player.x, player.y, INTERACT_RADIUS);
  if (!nearest) return;
  flushPendingMove();
  socket.emit('prop:pickup', nearest.id);
}

function tryPickupWithMouse() {
  if (!mouse.inside) return false;
  const target = nearestProp(mouse.worldX, mouse.worldY, CLICK_SELECT_RADIUS);
  if (!target) return false;
  const d2 = (target.x - player.x) ** 2 + (target.y - player.y) ** 2;
  if (d2 > INTERACT_RADIUS * INTERACT_RADIUS) return false;
  flushPendingMove();
  socket.emit('prop:pickup', target.id);
  return true;
}

// ----- Crafting (server-validated) -----
let awaitingCraftResponse = false;

function tryCraft() {
  if (awaitingCraftResponse) return false; // Prevent spam
  
  const a = inventory[0]; const b = inventory[1];
  if (!a || !b) return false;
  
  // Send craft request to server with item IDs
  const inputs = [
    { item_id: a.type, quantity: 1 },
    { item_id: b.type, quantity: 1 }
  ];
  
  awaitingCraftResponse = true;
  socket.emit('craft:request', inputs);
  return true;
}

// World helpers
function tIndex(tx: number, ty: number) { return ty * GRID_W + tx; }
function worldToTile(p: {x:number,y:number}) { return { tx: Math.max(0, Math.min(GRID_W - 1, Math.floor(p.x / CONFIG.TILE))), ty: Math.max(0, Math.min(GRID_H - 1, Math.floor(p.y / CONFIG.TILE))) }; }
function isWaterAt(x: number, y: number) { const { tx, ty } = worldToTile({x,y}); return terrain[tIndex(tx, ty)] === 1; }
function tileKey(tx: number, ty: number) { return `${tx},${ty}`; }
function hasBridgeAt(x: number, y: number) { const { tx, ty } = worldToTile({x,y}); return bridgeByTile.has(tileKey(tx, ty)); }
function hasWallAt(x: number, y: number) { const { tx, ty } = worldToTile({x,y}); return wallByTile.has(tileKey(tx, ty)); }
const FOOT_H = 6;
function rectOverlapsWall(x: number, y: number) {
  const halfW = player.width / 2;
  const x1 = Math.floor((x - halfW) / CONFIG.TILE);
  const y1 = Math.floor((y - FOOT_H) / CONFIG.TILE);
  const x2 = Math.floor((x + halfW - 1) / CONFIG.TILE);
  const y2 = Math.floor((y - 1) / CONFIG.TILE);
  for (let ty = y1; ty <= y2; ty++) {
    for (let tx = x1; tx <= x2; tx++) {
      if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) continue;
      if (hasWallAt(tx * CONFIG.TILE + 1, ty * CONFIG.TILE + 1)) return true;
    }
  }
  return false;
}
function isWalkableAt(x: number, y: number) { if (rectOverlapsWall(x, y)) return false; return !isWaterAt(x, y) || hasBridgeAt(x, y); }

// Wall removal press logic
const REQUIRED_WALL_PRESSES = 5; let wallPresses = 0; let lastWallTarget: string | null = null; let lastWallPressAt = 0;
function nearestWallTileInRadius(x: number, y: number, radius: number) {
  let best: TileItem | null = null; let bestD2 = Infinity;
  for (const w of walls.values()) {
    const cx = w.tx * CONFIG.TILE + CONFIG.TILE / 2; const cy = w.ty * CONFIG.TILE + CONFIG.TILE / 2;
    const dx = cx - x, dy = cy - y; const d2 = dx*dx + dy*dy;
    if (d2 <= radius*radius && d2 < bestD2) { bestD2 = d2; best = w; }
  }
  return best;
}
function tryWallRemovalPress() {
  const target = nearestWallTileInRadius(player.x, player.y, INTERACT_RADIUS); if (!target) return false;
  const now = performance.now(); const tkey = target.id;
  if (tkey === lastWallTarget && (now - lastWallPressAt) < 1500) wallPresses += 1; else { wallPresses = 1; lastWallTarget = tkey; }
  lastWallPressAt = now;
  if (wallPresses >= REQUIRED_WALL_PRESSES) { socket.emit('wall:remove', target.tx, target.ty); wallPresses = 0; lastWallTarget = null; }
  return true;
}

// Players
socket.on('player:new', (p: Player) => {
  if (p.id === selfId) {
    // Align local player with server-authoritative spawn
    player.x = p.x;
    player.y = p.y;
    player.color = p.color || '#111111'; // Store the player's color
    if (!selfSprite || !selfTextures) {
      selfTextures = generatePlayerTextures(player.color);
      selfSprite = new PIXI.Sprite(selfTextures[0]);
      selfSprite.roundPixels = true;
      playersLayer.addChild(selfSprite);
    }
    updateSelfSprite();
    updateCamera();
    return;
  }
  addRemote(p);
});
socket.on('player:update', (p: Player) => {
  if (p.id === selfId) {
    // Smoothly reconcile to server to avoid jitter; snap only if far
    const dx = p.x - player.x; const dy = p.y - player.y;
    const d2 = dx*dx + dy*dy;
    const SNAP_DIST2 = 16; // 4px
    if (d2 > SNAP_DIST2) {
      // Small lerp towards server position
      player.x += dx * 0.35;
      player.y += dy * 0.35;
    }
    return;
  }
  updateRemote(p);
});
socket.on('player:remove', (id: string) => removeRemote(id));

function addRemote(p: Player) {
  const color = p.color || '#555';
  const textures = generatePlayerTextures(color);
  const sprite = new PIXI.Sprite(textures[0]);
  sprite.roundPixels = true;
  // Position so feet are at (x,y)
  sprite.x = Math.round(p.x - BASE_W / 2);
  sprite.y = Math.round(p.y - BASE_H);
  playersLayer.addChild(sprite);
  remotes.set(p.id, { sprite, textures, color, stepTime: 0, stepIndex: 0, lastX: p.x, lastY: p.y });
}
function updateRemote(p: Player) {
  const e = remotes.get(p.id); if (!e) return;
  e.sprite.x = Math.round(p.x - BASE_W / 2);
  e.sprite.y = Math.round(p.y - BASE_H);
}
function removeRemote(id: string) {
  const e = remotes.get(id); if (!e) return;
  playersLayer.removeChild(e.sprite);
  e.sprite.destroy();
  e.textures.forEach(t => t.destroy(true));
  remotes.delete(id);
}

// World events
socket.on('world:init', (snap: WorldSnapshot) => {
  CONFIG = snap.config; GRID_W = snap.gridW; GRID_H = snap.gridH; terrain = new Uint8Array(snap.terrain);
  props.clear(); propsByTile.clear();
  for (const p of snap.props) { props.set(p.id, p); indexProp(p); }
  bridges.clear(); bridgeByTile.clear();
  for (const b of snap.bridges) { bridges.set(b.id, b); bridgeByTile.set(tileKey(b.tx, b.ty), b.id); }
  walls.clear(); wallByTile.clear();
  for (const w of snap.walls) { walls.set(w.id, w); wallByTile.set(tileKey(w.tx, w.ty), w.id); }
  drawTerrain(); rebuildBridges(); rebuildWalls(); rebuildProps();
});
socket.on('prop:removed', ({ id, type, by }) => {
  propsLayer.cacheAsBitmap = false;
  const sprite = propSprites.get(id); if (sprite) { propsLayer.removeChild(sprite); sprite.destroy(); }
  propSprites.delete(id);
  const old = props.get(id); if (old) unindexProp(old);
  props.delete(id);
  if (by === selfId) {
    const order: number[] = activeSlot >= 0 ? [activeSlot, 1 - activeSlot] : [0, 1];
    for (const s of order) { if (!inventory[s]) { inventory[s] = { type }; break; } }
    renderHUD();
  }
  propsLayer.cacheAsBitmap = true;
});
socket.on('prop:added', ({ id, type, x, y, by }) => {
  const p: SProp = { id, type, x, y };
  props.set(id, p); indexProp(p);
  addPropSprite(p);
  if (by === selfId && inventory[activeSlot]?.type === type) { inventory[activeSlot] = null; renderHUD(); }
});
socket.on('bridge:placed', (item: TileItem) => { bridges.set(item.id, item); bridgeByTile.set(tileKey(item.tx, item.ty), item.id); addBridgeSprite(item); if (item.by === selfId && inventory[activeSlot]?.type === 'plank') { inventory[activeSlot] = null; renderHUD(); } });
socket.on('wall:placed', (item: TileItem) => { walls.set(item.id, item); wallByTile.set(tileKey(item.tx, item.ty), item.id); addWallSprite(item); if (item.by === selfId && inventory[activeSlot]?.type === 'wall') { inventory[activeSlot] = null; renderHUD(); } });
socket.on('wall:removed', (id: string) => { const s = wallSprites.get(id); if (s) { wallsLayer.removeChild(s); s.destroy(); } wallSprites.delete(id); const w = walls.get(id); if (w) wallByTile.delete(tileKey(w.tx, w.ty)); walls.delete(id); });

// Item database sync
socket.on('items:sync', (items: Record<string, any>) => {
  itemDatabase.clear();
  for (const [id, item] of Object.entries(items)) {
    itemDatabase.set(id, item);
  }
  console.log(`Synced ${itemDatabase.size} items from server`);
});

socket.on('items:update', (items: Record<string, any>) => {
  for (const [id, item] of Object.entries(items)) {
    itemDatabase.set(id, item);
  }
  console.log(`Updated ${Object.keys(items).length} items from server`);
});

// Crafting results
socket.on('craft:result', (success: boolean, result?: { item_id: string; quantity: number }) => {
  awaitingCraftResponse = false;
  
  if (success && result) {
    console.log(`Crafting successful: ${result.quantity}x ${result.item_id}`);
    // Clear inputs
    inventory[0] = null;
    inventory[1] = null;
    // Put result into first free slot
    const res: InvProp = { type: result.item_id as PropType }; // Cast for now
    if (!inventory[0]) inventory[0] = res; else inventory[1] = res;
    renderHUD();
  } else {
    console.log('Crafting failed - no matching recipe');
  }
});

// Draw terrain once
function drawTerrain() {
  terrainLayer.clear();
  const water = 0xb3e5fc; const waterTop = 0x616161; // we just draw solid water tiles
  for (let ty = 0; ty < GRID_H; ty++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      if (terrain[tIndex(tx, ty)] !== 1) continue;
      terrainLayer.beginFill(water);
      terrainLayer.drawRect(tx * CONFIG.TILE, ty * CONFIG.TILE, CONFIG.TILE, CONFIG.TILE);
      terrainLayer.endFill();
    }
  }
  // Cache static terrain to reduce draw calls per frame
  terrainLayer.cacheAsBitmap = true;
}

// Bridges/Walls sprites per id
const bridgeSprites = new Map<string, PIXI.Graphics>();
const wallSprites = new Map<string, PIXI.Graphics>();

function addBridgeSprite(item: TileItem) {
  bridgesLayer.cacheAsBitmap = false;
  const g = new PIXI.Graphics();
  const x = item.tx * CONFIG.TILE; const y = item.ty * CONFIG.TILE;
  g.beginFill(0x6d4c41); g.drawRect(x, y + CONFIG.TILE/3, CONFIG.TILE, Math.ceil(CONFIG.TILE/3)); g.endFill();
  g.beginFill(0x8d6e63); g.drawRect(x, y + CONFIG.TILE/3 - 1, CONFIG.TILE, 1); g.endFill();
  bridgesLayer.addChild(g); bridgeSprites.set(item.id, g);
  bridgesLayer.cacheAsBitmap = true;
}
function addWallSprite(item: TileItem) {
  wallsLayer.cacheAsBitmap = false;
  const g = new PIXI.Graphics();
  const x = item.tx * CONFIG.TILE; const y = item.ty * CONFIG.TILE;
  g.beginFill(0x9e9e9e); g.drawRect(x, y, CONFIG.TILE, CONFIG.TILE); g.endFill();
  g.beginFill(0x616161); g.drawRect(x, y, CONFIG.TILE, 1); g.endFill();
  wallsLayer.addChild(g); wallSprites.set(item.id, g);
  wallsLayer.cacheAsBitmap = true;
}
function rebuildBridges() { bridgesLayer.cacheAsBitmap = false; bridgesLayer.removeChildren().forEach(c => c.destroy()); bridgeSprites.clear(); for (const b of bridges.values()) addBridgeSprite(b); bridgesLayer.cacheAsBitmap = true; }
function rebuildWalls() { wallsLayer.cacheAsBitmap = false; wallsLayer.removeChildren().forEach(c => c.destroy()); wallSprites.clear(); for (const w of walls.values()) addWallSprite(w); wallsLayer.cacheAsBitmap = true; }

// Props rendering
function addPropSprite(p: SProp) {
  propsLayer.cacheAsBitmap = false;
  const g = new PIXI.Graphics();
  drawPropGraphic(g, p.type);
  g.x = p.x; g.y = p.y; propsLayer.addChild(g); propSprites.set(p.id, g);
  propsLayer.cacheAsBitmap = true;
}
function drawPropGraphic(g: PIXI.Graphics, type: PropType) {
  g.clear();
  if (type === 'rock') { g.beginFill(0x888888); g.drawRect(-2, -1, 4, 2); g.endFill(); g.beginFill(0x666666); g.drawRect(-1, -2, 3, 1); g.endFill(); return; }
  if (type === 'bush') { g.beginFill(0x2e7d32); g.drawRect(-3, -2, 6, 2); g.endFill(); g.beginFill(0x43a047); g.drawRect(-2, -3, 4, 1); g.endFill(); return; }
  if (type === 'flower') { g.beginFill(0x8e24aa); g.drawRect(0, -2, 1, 1); g.endFill(); g.beginFill(0xe53935); g.drawRect(-1, -1, 1, 1); g.endFill(); g.beginFill(0xfb8c00); g.drawRect(1, -1, 1, 1); g.endFill(); g.beginFill(0x1e88e5); g.drawRect(0, 0, 1, 1); g.endFill(); return; }
  if (type === 'plank') { g.beginFill(0x6d4c41); g.drawRect(-2, -1, 5, 2); g.endFill(); g.beginFill(0x8d6e63); g.drawRect(-2, -2, 5, 1); g.endFill(); return; }
  if (type === 'wall') { g.beginFill(0x9e9e9e); g.drawRect(-2, -2, 5, 4); g.endFill(); g.beginFill(0x616161); g.drawRect(-2, -2, 5, 1); g.endFill(); return; }
  g.beginFill(0x999999); g.drawRect(0, 0, 1, 1); g.endFill();
}
function rebuildProps() {
  propsLayer.cacheAsBitmap = false;
  propsLayer.removeChildren().forEach(c => c.destroy());
  propSprites.clear(); propsByTile.clear();
  for (const p of props.values()) { indexProp(p); addPropSprite(p); }
  propsLayer.cacheAsBitmap = true;
}
function nearestProp(x: number, y: number, radius: number) { return nearestPropIndexed(x, y, radius); }

function indexProp(p: SProp) {
  const { tx, ty } = worldToTile({ x: p.x, y: p.y });
  const k = tileKey(tx, ty);
  let set = propsByTile.get(k);
  if (!set) { set = new Set(); propsByTile.set(k, set); }
  set.add(p.id);
}
function unindexProp(p: SProp) {
  const { tx, ty } = worldToTile({ x: p.x, y: p.y });
  const k = tileKey(tx, ty);
  const set = propsByTile.get(k);
  if (!set) return;
  set.delete(p.id);
  if (set.size === 0) propsByTile.delete(k);
}
function nearestPropIndexed(x: number, y: number, radius: number): SProp | null {
  const { tx, ty } = worldToTile({ x, y });
  const rTiles = Math.ceil(radius / CONFIG.TILE);
  let best: SProp | null = null; let bestD2 = radius * radius;
  for (let ty2 = ty - rTiles; ty2 <= ty + rTiles; ty2++) {
    if (ty2 < 0 || ty2 >= GRID_H) continue;
    for (let tx2 = tx - rTiles; tx2 <= tx + rTiles; tx2++) {
      if (tx2 < 0 || tx2 >= GRID_W) continue;
      const set = propsByTile.get(tileKey(tx2, ty2));
      if (!set) continue;
      for (const id of set) {
        const p = props.get(id); if (!p) continue;
        const dx = p.x - x, dy = p.y - y; const d2 = dx*dx + dy*dy;
        if (d2 <= bestD2) { bestD2 = d2; best = p; }
      }
    }
  }
  return best;
}

// Movement + camera
app.ticker.add(() => update());
// Throttle network movement to reduce spam and jitter
let pendingMoveDX = 0, pendingMoveDY = 0;
let lastMoveSentAt = 0;
const MOVE_SEND_INTERVAL_MS = 50; // 20 Hz
// Throttle UI overlay redraws to ~30 FPS
const UI_UPDATE_MS = 33;
let uiSince = 0;
let lastActivityAt = performance.now();
function update() {
  let dx = 0, dy = 0; 
  if (keys.has('a')) dx -= 1;
  if (keys.has('d')) dx += 1;
  if (keys.has('w')) dy -= 1;
  if (keys.has('s')) dy += 1;
  const moving = dx !== 0 || dy !== 0; let stepX = 0, stepY = 0;
  if (moving) {
    const len = Math.hypot(dx, dy) || 1; dx/=len; dy/=len; stepX = dx * player.speed * app.ticker.deltaMS / 1000; stepY = dy * player.speed * app.ticker.deltaMS / 1000;
    
    // Try diagonal movement first
    const tryX = clamp(player.x + stepX, 0, CONFIG.WORLD_WIDTH);
    const tryY = clamp(player.y + stepY, 0, CONFIG.WORLD_HEIGHT);
    
    if (isWalkableAt(tryX, tryY)) {
      // Diagonal movement is clear
      player.x = tryX;
      player.y = tryY;
    } else {
      // Diagonal blocked, try individual axes
      if (isWalkableAt(tryX, player.y)) player.x = tryX;
      if (isWalkableAt(player.x, tryY)) player.y = tryY;
    }
    
    if (Math.abs(dx) > Math.abs(dy)) player.face = dx > 0 ? 'right' : 'left'; else if (Math.abs(dy) > 0) player.face = dy > 0 ? 'down' : 'up';
    player.stepTime += app.ticker.deltaMS/1000; const frameDur = 1/8; if (player.stepTime >= frameDur) { player.stepTime -= frameDur; player.stepIndex = player.stepIndex === 1 ? 2 : 1; }
  } else { player.stepTime = 0; player.stepIndex = 0; }

  // Accumulate and throttle movement network updates
  if (selfId) {
    pendingMoveDX += stepX;
    pendingMoveDY += stepY;
    const now = performance.now();
    const movingNow = (stepX !== 0 || stepY !== 0);
    const due = (now - lastMoveSentAt) >= MOVE_SEND_INTERVAL_MS;
    if ((due && (pendingMoveDX !== 0 || pendingMoveDY !== 0)) || (!movingNow && (pendingMoveDX !== 0 || pendingMoveDY !== 0))) {
      socket.emit('move', pendingMoveDX, pendingMoveDY);
      pendingMoveDX = 0; pendingMoveDY = 0; lastMoveSentAt = now;
    }
  }

  updateCamera();
  // Keep mouse world coords consistent when camera moves
  if (mouse.inside) {
    mouse.worldX = mouse.x - worldContainer.x;
    mouse.worldY = mouse.y - worldContainer.y;
  }
  updateSelfSprite();
  updateRemotesAnimation();
  uiSince += app.ticker.deltaMS;
  const haveSelection = activeSlot >= 0 && !!inventory[activeSlot];
  const wantPlacementUI = haveSelection;
  // Always evaluate hover UI when mouse is inside (not only on movement)
  const wantHoverUI = !haveSelection && mouse.inside;
  if (uiSince >= UI_UPDATE_MS) {
    if (wantPlacementUI) {
      drawPlacementPreviews();
    } else {
      tileHighlight.visible = false;
      bridgeTargetHighlight.visible = false;
      propPlacementPreview.visible = false;
      propPlacementOutline.visible = false;
    }
    if (wantHoverUI) {
      drawPickupHighlight();
    } else {
      propPickupHighlight.visible = false;
    }
    uiSince = 0;
    mouseDirty = false;
  }

  // Dynamic idle FPS adjustment
  const now = performance.now();
  const overlaysVisible = tileHighlight.visible || bridgeTargetHighlight.visible || propPlacementPreview.visible || propPlacementOutline.visible || propPickupHighlight.visible;
  const movingNow = (stepX !== 0 || stepY !== 0);
  if (movingNow || overlaysVisible || wantHoverUI || wantPlacementUI) lastActivityAt = now;
  // @ts-ignore
  app.ticker.maxFPS = (now - lastActivityAt) > 250 ? 20 : 60;
}

// Ensure the server processes our latest local movement before important actions
function flushPendingMove() {
  if (!selfId) return;
  if (pendingMoveDX !== 0 || pendingMoveDY !== 0) {
    socket.emit('move', pendingMoveDX, pendingMoveDY);
    pendingMoveDX = 0;
    pendingMoveDY = 0;
    lastMoveSentAt = performance.now();
  }
}

// Slow down rendering when tab is hidden to save CPU
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Lower FPS when hidden
    // @ts-ignore
    app.ticker.maxFPS = 10;
  } else {
    // Restore FPS and force a UI refresh soon
    // @ts-ignore
    app.ticker.maxFPS = 60;
    uiSince = UI_UPDATE_MS;
  }
});

function updateCamera() { let x = Math.round(player.x - LOGICAL_WIDTH / 2); let y = Math.round(player.y - LOGICAL_HEIGHT / 2); x = clamp(x, 0, Math.max(0, CONFIG.WORLD_WIDTH - LOGICAL_WIDTH)); y = clamp(y, 0, Math.max(0, CONFIG.WORLD_HEIGHT - LOGICAL_HEIGHT)); worldContainer.x = -x; worldContainer.y = -y; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

// Self sprite updates
function updateSelfSprite() {
  if (!selfSprite || !selfTextures) return;
  // Update position (feet at player.x, player.y)
  selfSprite.x = Math.round(player.x - BASE_W / 2);
  selfSprite.y = Math.round(player.y - BASE_H);
  // Update frame texture when stepIndex changed
  selfSprite.texture = selfTextures[player.stepIndex];
}

function pointInFront(face: Facing, dist: number) { switch (face) { case 'left': return { x: player.x - dist, y: player.y }; case 'right': return { x: player.x + dist, y: player.y }; case 'up': return { x: player.x, y: player.y - dist }; default: return { x: player.x, y: player.y + dist }; } }

function updateRemotesAnimation() {
  const dt = app.ticker.deltaMS / 1000;
  for (const [id, e] of remotes) {
    const dx = e.sprite.x - e.lastX;
    const dy = e.sprite.y - e.lastY;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.01;
    if (moving) {
      e.stepTime += dt; const frameDur = 1/8;
      if (e.stepTime >= frameDur) { e.stepTime -= frameDur; e.stepIndex = e.stepIndex === 1 ? 2 : 1; e.sprite.texture = e.textures[e.stepIndex]; }
    } else if (e.stepIndex !== 0) { e.stepIndex = 0; e.stepTime = 0; e.sprite.texture = e.textures[0]; }
    e.lastX = e.sprite.x; e.lastY = e.sprite.y;
  }
}

// Cache state to avoid redrawing unchanged previews each frame
let lastTilePrevType: 'wall' | 'plank' | null = null;
let lastTilePrevTX = -1, lastTilePrevTY = -1; let lastTilePrevValid = false;
let lastPropPrevType: PropType | null = null; let lastPropPrevX = 0, lastPropPrevY = 0; let lastPropPrevInRange: boolean | null = null;
function drawPlacementPreviews() {
  tileHighlight.visible = false;
  bridgeTargetHighlight.visible = false;
  propPlacementPreview.visible = false;
  propPlacementOutline.visible = false;

  if (!mouse.inside) return;
  const it = inventory[activeSlot];
  if (!it) return;

  // Tile items: wall and plank (bridge)
  if (it.type === 'wall' || it.type === 'plank') {
    const { tx, ty } = worldToTile({ x: mouse.worldX, y: mouse.worldY });
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return;
    const x = tx * CONFIG.TILE; const y = ty * CONFIG.TILE;
    const cx = x + CONFIG.TILE / 2; const cy = y + CONFIG.TILE / 2;
    const inRange = ((cx - player.x) ** 2 + (cy - player.y) ** 2) <= (PLACE_RADIUS * PLACE_RADIUS);

    if (it.type === 'plank') {
      const isWater = terrain[tIndex(tx, ty)] === 1;
      const exists = bridgeByTile.has(tileKey(tx, ty));
      const valid = isWater && !exists && inRange;
      // Redraw only if changed
      if (lastTilePrevType !== 'plank' || lastTilePrevTX !== tx || lastTilePrevTY !== ty || lastTilePrevValid !== valid) {
        bridgeTargetHighlight.clear();
        bridgeTargetHighlight.lineStyle(1, valid ? 0x2e7d32 : 0xb71c1c, 0.35);
        bridgeTargetHighlight.beginFill(valid ? 0x66bb6a : 0xef9a9a, 0.22);
        bridgeTargetHighlight.drawRect(x, y, CONFIG.TILE, CONFIG.TILE);
        bridgeTargetHighlight.endFill();
        lastTilePrevType = 'plank'; lastTilePrevTX = tx; lastTilePrevTY = ty; lastTilePrevValid = valid;
      }
      bridgeTargetHighlight.visible = true;
    } else {
      const isLand = terrain[tIndex(tx, ty)] === 0;
      const exists = wallByTile.has(tileKey(tx, ty));
      const valid = isLand && !exists && inRange;
      if (lastTilePrevType !== 'wall' || lastTilePrevTX !== tx || lastTilePrevTY !== ty || lastTilePrevValid !== valid) {
        tileHighlight.clear();
        tileHighlight.lineStyle(1, valid ? 0x2e7d32 : 0xb71c1c, 0.35);
        tileHighlight.beginFill(valid ? 0x66bb6a : 0xef9a9a, 0.22);
        tileHighlight.drawRect(x, y, CONFIG.TILE, CONFIG.TILE);
        tileHighlight.endFill();
        lastTilePrevType = 'wall'; lastTilePrevTX = tx; lastTilePrevTY = ty; lastTilePrevValid = valid;
      }
      tileHighlight.visible = true;
    }
    return;
  }

  // Free-prop preview at mouse world position
  const px = Math.round(mouse.worldX);
  const py = Math.round(mouse.worldY);
  const inRange = ((px - player.x) ** 2 + (py - player.y) ** 2) <= (PROP_PLACE_RADIUS * PROP_PLACE_RADIUS);
  // Draw the ghost only once per type; move it each frame
  if (lastPropPrevType !== it.type) {
    propPlacementPreview.clear();
    propPlacementPreview.alpha = 0.55;
    drawPropGraphic(propPlacementPreview, it.type);
    lastPropPrevType = it.type;
  }
  propPlacementPreview.x = px;
  propPlacementPreview.y = py;
  propPlacementPreview.visible = true;
  // Outline ring: redraw only if changed
  if (lastPropPrevX !== px || lastPropPrevY !== py || lastPropPrevInRange !== inRange) {
    propPlacementOutline.clear();
    propPlacementOutline.lineStyle(1, inRange ? 0x2e7d32 : 0xb71c1c, 0.6);
    propPlacementOutline.drawCircle(px, py, 4);
    lastPropPrevX = px; lastPropPrevY = py; lastPropPrevInRange = inRange;
  }
  propPlacementOutline.visible = true;
}

let lastPickupId: string | null = null;
function drawPickupHighlight() {
  // Only highlight when mouse is over a prop and hand is empty
  if (!mouse.inside || inventory[activeSlot]) { propPickupHighlight.visible = false; lastPickupId = null; return; }

  const hovered = nearestProp(mouse.worldX, mouse.worldY, CLICK_SELECT_RADIUS);
  if (!hovered) { propPickupHighlight.visible = false; lastPickupId = null; return; }
  // Only highlight if actually pickable (within interact radius from player)
  const inReach = ((hovered.x - player.x) ** 2 + (hovered.y - player.y) ** 2) <= (INTERACT_RADIUS * INTERACT_RADIUS);
  if (!inReach) { propPickupHighlight.visible = false; lastPickupId = null; return; }

  if (lastPickupId !== hovered.id) {
    propPickupHighlight.clear();
    propPickupHighlight.lineStyle(1, 0x1976d2, 0.9);
    propPickupHighlight.drawCircle(hovered.x, hovered.y, 5);
    lastPickupId = hovered.id;
  }
  propPickupHighlight.visible = true;
}

// Draw a silhouette at local origin (0,0) as feet center for remote players
function makeManGraphic(stepIndex: number, color: string): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const swing = stepIndex === 0 ? 0 : (stepIndex === 1 ? -1 : 1);
  const cx = Math.floor(BASE_W / 2);
  const fillNum = cssColorToHex(color);
  g.beginFill(fillNum);
  // Draw relative to top-left (0,0)
  g.drawRect(cx - 2, 0, 4, 4);
  g.drawRect(cx - 1, 4, 2, 1);
  g.drawRect(cx - 3, 5, 6, 6);
  g.drawRect(cx - 5 + swing, 6, 2, 4);
  g.drawRect(cx + 3 - swing, 6, 2, 4);
  g.drawRect(cx - 3, 11, 6, 1);
  g.drawRect(cx - 3 + swing, 12, 2, 6);
  g.drawRect(cx + 1 - swing, 12, 2, 6);
  g.endFill();
  return g;
}

function generatePlayerTextures(color: string): [PIXI.Texture, PIXI.Texture, PIXI.Texture] {
  const frames: [number, number, number] = [0, 1, 2];
  const textures = frames.map((idx) => {
    const g = makeManGraphic(idx, color);
    const tex = app.renderer.generateTexture(g, { resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
    g.destroy();
    return tex;
  }) as [PIXI.Texture, PIXI.Texture, PIXI.Texture];
  return textures;
}

// Convert CSS color string to numeric hex
function cssColorToHex(color: string): number {
  // Hex format
  if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
    let hex = color.substring(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    return parseInt(hex, 16);
  }
  // rgb/rgba
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch as any;
    return (parseInt(r) << 16) + (parseInt(g) << 8) + parseInt(b);
  }
  // Named colors fallback via canvas
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    ctx.fillStyle = color as any;
    const val = ctx.fillStyle as unknown as string;
    if (typeof val === 'string' && val.startsWith('#')) return parseInt(val.slice(1), 16) || 0x111111;
  }
  return 0x111111;
}

// ===== HUD (inventory) =====
const hudG = new PIXI.Graphics();
uiContainer.addChild(hudG);
const hudIcons: [PIXI.Graphics, PIXI.Graphics] = [new PIXI.Graphics(), new PIXI.Graphics()];
uiContainer.addChild(hudIcons[0], hudIcons[1]);

function renderHUD() {
  const slotW = 18, slotH = 12; const pad = 4; const baseX = 6, baseY = LOGICAL_HEIGHT - slotH - 6;
  hudG.clear();
  for (let i = 0; i < 2; i++) {
    const x = baseX + i * (slotW + pad); const y = baseY;
    hudG.beginFill(0x000000, 0.08); hudG.drawRect(x, y, slotW, slotH); hudG.endFill();
    hudG.lineStyle(1, i === activeSlot ? 0x111111 : 0x666666, 1); hudG.drawRect(x + 0.5, y + 0.5, slotW - 1, slotH - 1); hudG.lineStyle(0);
    // key indicator
    hudG.beginFill(0x000000); hudG.drawRect(x - 1, y + slotH + 1, 6, 3); hudG.endFill();
    hudG.beginFill(0xffffff); if (i === 0) hudG.drawRect(x, y + slotH + 2, 1, 1); else hudG.drawRect(x + 2, y + slotH + 2, 1, 1); hudG.endFill();
    // item icon
    const icon = hudIcons[i]; icon.clear(); icon.x = x + Math.floor(slotW / 2); icon.y = y + Math.floor(slotH / 2);
    const it = inventory[i];
    if (it) { drawPropGraphic(icon, it.type); }
  }
}

// Update HUD when slot changes
window.addEventListener('keydown', (e) => { if (e.key === '1' || e.key === '2') renderHUD(); });

// Initial HUD
renderHUD();
