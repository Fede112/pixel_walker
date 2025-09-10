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

// DOM overlay handling
const overlayEl = document.getElementById('overlay');
function hideOverlay() { overlayEl?.classList.add('hidden'); }
function overlayVisible() { return !!overlayEl && !overlayEl.classList.contains('hidden'); }
overlayEl?.addEventListener('click', hideOverlay);
window.addEventListener('keydown', (e) => {
  if (!overlayVisible()) return;
  if (['Enter', ' ', 'Space', 'Escape', 'Esc'].includes(e.key) || e.key.startsWith('Arrow')) { e.preventDefault(); hideOverlay(); }
});

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

const worldContainer = new PIXI.Container();
app.stage.addChild(worldContainer);

// Layers
const terrainLayer = new PIXI.Graphics();
const bridgesLayer = new PIXI.Container(); // id -> graphics
const wallsLayer = new PIXI.Container(); // id -> graphics
const propsLayer = new PIXI.Container(); // id -> graphics
const playersLayer = new PIXI.Container();
const uiContainer = new PIXI.Container();

worldContainer.addChild(terrainLayer, bridgesLayer, wallsLayer, propsLayer, playersLayer);
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
type RemoteEntity = { gfx: PIXI.Graphics; color: string; stepTime: number; stepIndex: number; lastX: number; lastY: number };
const remotes = new Map<string, RemoteEntity>();

// Player local
type Facing = 'up' | 'down' | 'left' | 'right';
const BASE_W = 12; const BASE_H = 18;
const player = { x: 100, y: 100, speed: 60, width: BASE_W * SPRITE_SCALE, height: BASE_H * SPRITE_SCALE, face: 'down' as Facing, stepTime: 0, stepIndex: 0 };

// Inventory (client-side only)
type InvProp = { id?: string; type: PropType };
const inventory: (InvProp | null)[] = [null, null];
let activeSlot = 0;

// Keys
const keys = new Set<string>();
window.addEventListener('keydown', (e) => { if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Space"].includes(e.key)) e.preventDefault(); keys.add(e.key); });
window.addEventListener('keyup', (e) => keys.delete(e.key));

// Interact keys
window.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); interact(); }
  if (e.key === '1') activeSlot = 0;
  if (e.key === '2') activeSlot = 1;
});

function interact() {
  const item = inventory[activeSlot];
  if (!item) {
    // Try remove wall first (press sequence)
    if (tryWallRemovalPress()) return;
    // Else try pickup nearest prop (by id)
    const nearest = nearestProp(player.x, player.y, INTERACT_RADIUS);
    if (!nearest) return;
    socket.emit('prop:pickup', nearest.id);
    return;
  }
  if (item.type === 'plank') {
    const { tx, ty } = worldToTile(pointInFront(player.face, CONFIG.TILE));
    socket.emit('bridge:place', tx, ty);
    return;
  }
  if (item.type === 'wall') {
    const { tx, ty } = worldToTile({ x: player.x, y: player.y });
    socket.emit('wall:place', tx, ty);
    return;
  }
  // Drop any other item in front
  const pt = pointInFront(player.face, Math.floor(CONFIG.TILE / 2));
  socket.emit('prop:drop', item.type, Math.round(pt.x), Math.round(pt.y));
}

// World helpers
function tIndex(tx: number, ty: number) { return ty * GRID_W + tx; }
function worldToTile(p: {x:number,y:number}) { return { tx: Math.max(0, Math.min(GRID_W - 1, Math.floor(p.x / CONFIG.TILE))), ty: Math.max(0, Math.min(GRID_H - 1, Math.floor(p.y / CONFIG.TILE))) }; }
function isWaterAt(x: number, y: number) { const { tx, ty } = worldToTile({x,y}); return terrain[tIndex(tx, ty)] === 1; }
function hasBridgeAt(x: number, y: number) { const { tx, ty } = worldToTile({x,y}); for (const b of bridges.values()) { if (b.tx === tx && b.ty === ty) return true; } return false; }
function hasWallAt(x: number, y: number) { const { tx, ty } = worldToTile({x,y}); for (const w of walls.values()) { if (w.tx === tx && w.ty === ty) return true; } return false; }
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
    updateCamera();
    return;
  }
  addRemote(p);
});
socket.on('player:update', (p: Player) => { if (p.id === selfId) return; updateRemote(p); });
socket.on('player:remove', (id: string) => removeRemote(id));

function addRemote(p: Player) {
  const g = new PIXI.Graphics();
  drawManGraphic(g, p.color || '#555', 0);
  g.x = p.x; g.y = p.y;
  playersLayer.addChild(g);
  remotes.set(p.id, { gfx: g, color: p.color || '#555', stepTime: 0, stepIndex: 0, lastX: p.x, lastY: p.y });
}
function updateRemote(p: Player) {
  const e = remotes.get(p.id); if (!e) return; e.gfx.x = p.x; e.gfx.y = p.y;
}
function removeRemote(id: string) { const e = remotes.get(id); if (!e) return; playersLayer.removeChild(e.gfx); e.gfx.destroy(); remotes.delete(id); }

// World events
socket.on('world:init', (snap: WorldSnapshot) => {
  CONFIG = snap.config; GRID_W = snap.gridW; GRID_H = snap.gridH; terrain = new Uint8Array(snap.terrain);
  props.clear(); for (const p of snap.props) props.set(p.id, p);
  bridges.clear(); for (const b of snap.bridges) bridges.set(b.id, b);
  walls.clear(); for (const w of snap.walls) walls.set(w.id, w);
  drawTerrain(); rebuildBridges(); rebuildWalls(); rebuildProps();
});
socket.on('prop:removed', ({ id, type, by }) => {
  const sprite = propSprites.get(id); if (sprite) { propsLayer.removeChild(sprite); sprite.destroy(); }
  propSprites.delete(id); props.delete(id);
  if (by === selfId) {
    const slot = activeSlot;
    if (!inventory[slot]) inventory[slot] = { type };
    else if (!inventory[1 - slot]) inventory[1 - slot] = { type };
    renderHUD();
  }
});
socket.on('prop:added', ({ id, type, x, y, by }) => {
  const p: SProp = { id, type, x, y } as any;
  props.set(id, p);
  addPropSprite(p);
  if (by === selfId && inventory[activeSlot]?.type === type) { inventory[activeSlot] = null; renderHUD(); }
});
socket.on('bridge:placed', (item: TileItem) => { bridges.set(item.id, item); addBridgeSprite(item); if (item.by === selfId && inventory[activeSlot]?.type === 'plank') { inventory[activeSlot] = null; renderHUD(); } });
socket.on('wall:placed', (item: TileItem) => { walls.set(item.id, item); addWallSprite(item); if (item.by === selfId && inventory[activeSlot]?.type === 'wall') { inventory[activeSlot] = null; renderHUD(); } });
socket.on('wall:removed', (id: string) => { const s = wallSprites.get(id); if (s) { wallsLayer.removeChild(s); s.destroy(); } wallSprites.delete(id); walls.delete(id); });

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
}

// Bridges/Walls sprites per id
const bridgeSprites = new Map<string, PIXI.Graphics>();
const wallSprites = new Map<string, PIXI.Graphics>();

function addBridgeSprite(item: TileItem) {
  const g = new PIXI.Graphics();
  const x = item.tx * CONFIG.TILE; const y = item.ty * CONFIG.TILE;
  g.beginFill(0x6d4c41); g.drawRect(x, y + CONFIG.TILE/3, CONFIG.TILE, Math.ceil(CONFIG.TILE/3)); g.endFill();
  g.beginFill(0x8d6e63); g.drawRect(x, y + CONFIG.TILE/3 - 1, CONFIG.TILE, 1); g.endFill();
  bridgesLayer.addChild(g); bridgeSprites.set(item.id, g);
}
function addWallSprite(item: TileItem) {
  const g = new PIXI.Graphics();
  const x = item.tx * CONFIG.TILE; const y = item.ty * CONFIG.TILE;
  g.beginFill(0x9e9e9e); g.drawRect(x, y, CONFIG.TILE, CONFIG.TILE); g.endFill();
  g.beginFill(0x616161); g.drawRect(x, y, CONFIG.TILE, 1); g.endFill();
  wallsLayer.addChild(g); wallSprites.set(item.id, g);
}
function rebuildBridges() { bridgesLayer.removeChildren().forEach(c => c.destroy()); bridgeSprites.clear(); for (const b of bridges.values()) addBridgeSprite(b); }
function rebuildWalls() { wallsLayer.removeChildren().forEach(c => c.destroy()); wallSprites.clear(); for (const w of walls.values()) addWallSprite(w); }

// Props rendering
function addPropSprite(p: SProp) {
  const g = new PIXI.Graphics();
  drawPropGraphic(g, p.type);
  g.x = p.x; g.y = p.y; propsLayer.addChild(g); propSprites.set(p.id, g);
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
function rebuildProps() { propsLayer.removeChildren().forEach(c => c.destroy()); propSprites.clear(); for (const p of props.values()) addPropSprite(p); }
function nearestProp(x: number, y: number, radius: number) { let best: SProp | null = null; let bestD2 = Infinity; for (const p of props.values()) { const dx = p.x - x, dy = p.y - y, d2 = dx*dx + dy*dy; if (d2 <= radius*radius && d2 < bestD2) { best = p; bestD2 = d2; } } return best; }

// Movement + camera
app.ticker.add(() => update());
function update() {
  let dx = 0, dy = 0; if (keys.has('ArrowLeft')) dx -= 1; if (keys.has('ArrowRight')) dx += 1; if (keys.has('ArrowUp')) dy -= 1; if (keys.has('ArrowDown')) dy += 1;
  const moving = dx !== 0 || dy !== 0; let stepX = 0, stepY = 0;
  if (moving) {
    const len = Math.hypot(dx, dy) || 1; dx/=len; dy/=len; stepX = dx * player.speed * app.ticker.deltaMS / 1000; stepY = dy * player.speed * app.ticker.deltaMS / 1000;
    const tryX = clamp(player.x + stepX, 0, CONFIG.WORLD_WIDTH); if (isWalkableAt(tryX, player.y)) player.x = tryX;
    const tryY = clamp(player.y + stepY, 0, CONFIG.WORLD_HEIGHT); if (isWalkableAt(player.x, tryY)) player.y = tryY;
    if (Math.abs(dx) > Math.abs(dy)) player.face = dx > 0 ? 'right' : 'left'; else if (Math.abs(dy) > 0) player.face = dy > 0 ? 'down' : 'up';
    player.stepTime += app.ticker.deltaMS/1000; const frameDur = 1/8; if (player.stepTime >= frameDur) { player.stepTime -= frameDur; player.stepIndex = player.stepIndex === 1 ? 2 : 1; }
  } else { player.stepTime = 0; player.stepIndex = 0; }

  // Emit movement
  if (selfId && (stepX !== 0 || stepY !== 0)) socket.emit('move', stepX, stepY);

  updateCamera();
  drawSelf();
  updateRemotesAnimation();
}

function updateCamera() { let x = Math.round(player.x - LOGICAL_WIDTH / 2); let y = Math.round(player.y - LOGICAL_HEIGHT / 2); x = clamp(x, 0, Math.max(0, CONFIG.WORLD_WIDTH - LOGICAL_WIDTH)); y = clamp(y, 0, Math.max(0, CONFIG.WORLD_HEIGHT - LOGICAL_HEIGHT)); worldContainer.x = -x; worldContainer.y = -y; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

// Draw self silhouette as graphics (cleared and re-drawn minimal)
const selfG = new PIXI.Graphics(); playersLayer.addChild(selfG);
function drawSelf() {
  const sx = player.x, sy = player.y; const swing = player.stepIndex === 0 ? 0 : (player.stepIndex === 1 ? -1 : 1);
  selfG.clear(); selfG.beginFill(0x111111);
  const cx = Math.floor(BASE_W / 2); const left = Math.round(sx - player.width / 2); const top = Math.round(sy - player.height);
  // Translate via matrix: simply draw at world coords
  // Head
  selfG.drawRect(left + cx - 2, top + 0, 4, 4);
  selfG.drawRect(left + cx - 1, top + 4, 2, 1);
  selfG.drawRect(left + cx - 3, top + 5, 6, 6);
  selfG.drawRect(left + cx - 5 + swing, top + 6, 2, 4);
  selfG.drawRect(left + cx + 3 - swing, top + 6, 2, 4);
  selfG.drawRect(left + cx - 3, top + 11, 6, 1);
  selfG.drawRect(left + cx - 3 + swing, top + 12, 2, 6);
  selfG.drawRect(left + cx + 1 - swing, top + 12, 2, 6);
  selfG.endFill();
}

function pointInFront(face: Facing, dist: number) { switch (face) { case 'left': return { x: player.x - dist, y: player.y }; case 'right': return { x: player.x + dist, y: player.y }; case 'up': return { x: player.x, y: player.y - dist }; default: return { x: player.x, y: player.y + dist }; } }

function updateRemotesAnimation() {
  const dt = app.ticker.deltaMS / 1000;
  for (const [id, e] of remotes) {
    const dx = e.gfx.x - e.lastX;
    const dy = e.gfx.y - e.lastY;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.01;
    if (moving) {
      e.stepTime += dt; const frameDur = 1/8;
      if (e.stepTime >= frameDur) { e.stepTime -= frameDur; e.stepIndex = e.stepIndex === 1 ? 2 : 1; drawManGraphic(e.gfx, e.color, e.stepIndex); }
    } else if (e.stepIndex !== 0) { e.stepIndex = 0; e.stepTime = 0; drawManGraphic(e.gfx, e.color, 0); }
    e.lastX = e.gfx.x; e.lastY = e.gfx.y;
  }
}

// Draw a silhouette at local origin (0,0) as feet center for remote players
function drawManGraphic(g: PIXI.Graphics, color: string, stepIndex: number) {
  g.clear();
  const swing = stepIndex === 0 ? 0 : (stepIndex === 1 ? -1 : 1);
  const cx = Math.floor(BASE_W / 2);
  const left = -Math.round(player.width / 2);
  const top = -Math.round(player.height);
  const fillNum = (PIXI as any).Color?.fromCssColorString ? (PIXI as any).Color.fromCssColorString(color).toNumber() : 0x111111;
  g.beginFill(fillNum);
  g.drawRect(left + cx - 2, top + 0, 4, 4);
  g.drawRect(left + cx - 1, top + 4, 2, 1);
  g.drawRect(left + cx - 3, top + 5, 6, 6);
  g.drawRect(left + cx - 5 + swing, top + 6, 2, 4);
  g.drawRect(left + cx + 3 - swing, top + 6, 2, 4);
  g.drawRect(left + cx - 3, top + 11, 6, 1);
  g.drawRect(left + cx - 3 + swing, top + 12, 2, 6);
  g.drawRect(left + cx + 1 - swing, top + 12, 2, 6);
  g.endFill();
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
