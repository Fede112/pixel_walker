// Minimal pixel-art walker on a white canvas.
// No external assets; sprite is drawn with integer rectangles.

const LOGICAL_WIDTH = 192;   // low-res logical canvas for crisp pixels
const LOGICAL_HEIGHT = 108;
const SPRITE_SCALE = 1;      // smaller character

// World is larger than the viewport
const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 800;
const INTERACT_RADIUS = 10; // pickup radius in world pixels

// Tile grid for terrain and bridges
const TILE = 8; // world pixels per tile
const GRID_W = Math.ceil(WORLD_WIDTH / TILE);
const GRID_H = Math.ceil(WORLD_HEIGHT / TILE);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Overlay handling (onboarding)
const overlayEl = document.getElementById('overlay');
function hideOverlay() {
  if (!overlayEl) return;
  overlayEl.classList.add('hidden');
}
function overlayVisible() {
  return overlayEl && !overlayEl.classList.contains('hidden');
}
overlayEl?.addEventListener('click', hideOverlay);
window.addEventListener('keydown', (e) => {
  if (!overlayVisible()) return;
  if (['Enter', ' ', 'Space', 'Escape', 'Esc'].includes(e.key) || e.key.startsWith('Arrow')) {
    e.preventDefault();
    hideOverlay();
  }
});

// Keep an integer scale so pixels stay crisp
function resize() {
  const scale = Math.max(1, Math.floor(Math.min(
    window.innerWidth / LOGICAL_WIDTH,
    window.innerHeight / LOGICAL_HEIGHT
  )));

  canvas.width = LOGICAL_WIDTH;
  canvas.height = LOGICAL_HEIGHT;
  canvas.style.width = `${LOGICAL_WIDTH * scale}px`;
  canvas.style.height = `${LOGICAL_HEIGHT * scale}px`;
}

window.addEventListener('resize', resize);
resize();

// Input handling
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Space"].includes(e.key)) {
    e.preventDefault();
  }
  keys.add(e.key);
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

// Interact + inventory: E to grab/place; 1/2 to switch slot; C to craft
window.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    if (inventory[activeSlot]) {
      placeDown(activeSlot);
    } else {
      // If there's a wall in range, apply removal press; otherwise pick up prop
      if (!tryWallRemovalPress()) {
        pickUp(activeSlot);
      }
    }
  }
  if (e.key === '1') activeSlot = 0;
  if (e.key === '2') activeSlot = 1;
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    tryCraft();
  }
});

// Player state
const BASE_W = 12;
const BASE_H = 18;
const player = {
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
  speed: 60, // pixels per second in world space
  width: BASE_W * SPRITE_SCALE,
  height: BASE_H * SPRITE_SCALE,
  face: 'down', // 'up' | 'down' | 'left' | 'right'
  stepTime: 0,
  stepIndex: 0, // 0 = idle, 1 = step A, 2 = step B
};

// ---- Terrain (rivers) + structures ----
// terrain: 0 land, 1 water
const terrain = new Uint8Array(GRID_W * GRID_H);
// bridges: 0 none, 1 placed (walkable over water)
const bridges = new Uint8Array(GRID_W * GRID_H);
// walls: 0 none, 1 stone wall (blocks movement)
const walls = new Uint8Array(GRID_W * GRID_H);

function tIndex(tx, ty) { return ty * GRID_W + tx; }
function worldToTile(x, y) {
  return {
    tx: Math.max(0, Math.min(GRID_W - 1, Math.floor(x / TILE))),
    ty: Math.max(0, Math.min(GRID_H - 1, Math.floor(y / TILE)))
  };
}
function isWaterAt(x, y) {
  const { tx, ty } = worldToTile(x, y);
  return terrain[tIndex(tx, ty)] === 1;
}
function hasBridgeAt(x, y) {
  const { tx, ty } = worldToTile(x, y);
  return bridges[tIndex(tx, ty)] === 1;
}
function hasWallAt(x, y) {
  const { tx, ty } = worldToTile(x, y);
  return walls[tIndex(tx, ty)] === 1;
}

// Use a footprint rectangle near the player's feet to collide with walls,
// so you can't clip over wall edges.
const FOOT_H = 6; // collision height at the feet area
function rectOverlapsWall(x, y) {
  const halfW = player.width / 2;
  const x1 = Math.floor((x - halfW) / TILE);
  const y1 = Math.floor((y - FOOT_H) / TILE);
  const x2 = Math.floor((x + halfW - 1) / TILE);
  const y2 = Math.floor((y - 1) / TILE);
  const minTX = Math.max(0, x1);
  const minTY = Math.max(0, y1);
  const maxTX = Math.min(GRID_W - 1, x2);
  const maxTY = Math.min(GRID_H - 1, y2);
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (walls[tIndex(tx, ty)] === 1) return true;
    }
  }
  return false;
}

function isWalkableAt(x, y) {
  // Block if any part of the feet footprint overlaps a wall tile
  if (rectOverlapsWall(x, y)) return false;
  // Water rule: feet center tile must be land or bridged
  return !isWaterAt(x, y) || hasBridgeAt(x, y);
}

// Deterministic PRNG for terrain
let worldSeed = 2025;
function wrand() {
  worldSeed ^= worldSeed << 13; worldSeed ^= worldSeed >>> 17; worldSeed ^= worldSeed << 5;
  return ((worldSeed >>> 0) / 4294967296);
}

function generateRivers() {
  terrain.fill(0);
  const rivers = 2 + Math.floor(wrand() * 2); // 2-3 rivers
  for (let r = 0; r < rivers; r++) {
    let y = Math.floor(wrand() * GRID_H);
    let width = 2 + Math.floor(wrand() * 2); // 2-3
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

generateRivers();

// Inventory: two slots, each holds one prop or null
const inventory = [null, null];
let activeSlot = 0;

// Draw a tiny pixel-art silhouette man.
// Drawn as rectangles on a small grid (integer coordinates for crisp pixels).
// The animation toggles legs/arms between two poses when moving.
function drawMan(ctx, sx, sy, facing, stepIndex) {
  // sx, sy are screen-space anchor coordinates (feet center).
  const w = player.width;
  const h = player.height;
  const left = Math.round(sx - w / 2);
  const top = Math.round(sy - h);

  // Simple two-step walk cycle: -1, 0, +1 lateral offsets (base units)
  const swing = stepIndex === 0 ? 0 : (stepIndex === 1 ? -1 : 1);

  // Draw in base pixel units, scaled up by SPRITE_SCALE for clarity
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);

  ctx.fillStyle = '#111';

  const cx = Math.floor(BASE_W / 2);

  // Head: 4x4 centered
  fillRect(cx - 2, 0, 4, 4);

  // Neck: 2x1
  fillRect(cx - 1, 4, 2, 1);

  // Torso: 6x6 centered
  fillRect(cx - 3, 5, 6, 6);

  // Arms: 2x4 each, swing horizontally a bit
  // left arm
  fillRect(cx - 5 + swing, 6, 2, 4);
  // right arm
  fillRect(cx + 3 - swing, 6, 2, 4);

  // Waist block
  fillRect(cx - 3, 11, 6, 1);

  // Legs: 2x6 each, alternately spread/close
  // left leg
  fillRect(cx - 3 + swing, 12, 2, 6);
  // right leg
  fillRect(cx + 1 - swing, 12, 2, 6);

  // Tiny shadow under feet (subtle)
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  fillRect(cx - 4, BASE_H - 1, 8, 1);

  ctx.restore();

  function fillRect(x, y, w, h) {
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
}

// Game loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp long frames
  last = now;

  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function update(dt) {
  let dx = 0, dy = 0;
  if (keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('ArrowRight')) dx += 1;
  if (keys.has('ArrowUp')) dy -= 1;
  if (keys.has('ArrowDown')) dy += 1;

  const moving = dx !== 0 || dy !== 0;
  if (moving) {
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const stepX = dx * player.speed * dt;
    const stepY = dy * player.speed * dt;
    // per-axis collision against water (unless bridged)
    const tryX = clamp(player.x + stepX, 0, WORLD_WIDTH);
    if (isWalkableAt(tryX, player.y)) player.x = tryX;
    const tryY = clamp(player.y + stepY, 0, WORLD_HEIGHT);
    if (isWalkableAt(player.x, tryY)) player.y = tryY;

    // face toward last input direction (priority: horizontal > vertical)
    if (Math.abs(dx) > Math.abs(dy)) {
      player.face = dx > 0 ? 'right' : 'left';
    } else if (Math.abs(dy) > 0) {
      player.face = dy > 0 ? 'down' : 'up';
    }

    // advance walk cycle at ~8 fps
    player.stepTime += dt;
    const frameDur = 1 / 8;
    if (player.stepTime >= frameDur) {
      player.stepTime -= frameDur;
      player.stepIndex = player.stepIndex === 1 ? 2 : 1; // toggle 1 <-> 2
    }
  } else {
    player.stepTime = 0;
    player.stepIndex = 0; // idle
  }

  // keep inside world bounds (anchor is feet center)
  const halfW = player.width / 2;
  const footY = player.height; // we anchor at feet
  player.x = clamp(player.x, halfW, WORLD_WIDTH - halfW);
  player.y = clamp(player.y, footY, WORLD_HEIGHT);
}

function render() {
  // Compute camera to center on player, clamp to world
  const cam = computeCamera();

  // White background (explicit, though the body is also white)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Terrain, bridges, and walls
  drawTerrain(ctx, cam.x, cam.y);
  drawBridges(ctx, cam.x, cam.y);
  drawWalls(ctx, cam.x, cam.y);

  // Draw scattered props within view
  drawProps(ctx, cam.x, cam.y);

  // Highlight nearest prop if in range and active slot empty
  if (!inventory[activeSlot]) {
    const idx = nearestPropIndex(player.x, player.y, INTERACT_RADIUS);
    if (idx !== -1) {
      const p = props[idx];
      drawPropHighlight(ctx, p, cam.x, cam.y);
    }
  }

  // Highlight wall under focus for removal (if any)
  const wl = nearestWallTileInRadius(player.x, player.y, INTERACT_RADIUS);
  if (wl) drawWallHighlight(ctx, wl.tx, wl.ty, cam.x, cam.y, wallPresses, REQUIRED_WALL_PRESSES);

  // Draw the player in screen-space
  const sx = Math.round(player.x - cam.x);
  const sy = Math.round(player.y - cam.y);
  drawMan(ctx, sx, sy, player.face, player.stepIndex);

  // If active slot has an item, preview it above the player
  if (inventory[activeSlot]) {
    const offY = 10; // raise above feet in screen space
    const hx = Math.round(player.x - cam.x);
    const hy = Math.round(player.y - cam.y - offY);
    drawPropByType(ctx, inventory[activeSlot].type, hx, hy);
  }

  // UI: inventory slots
  drawInventory(ctx);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function computeCamera() {
  let x = Math.round(player.x - LOGICAL_WIDTH / 2);
  let y = Math.round(player.y - LOGICAL_HEIGHT / 2);
  x = clamp(x, 0, Math.max(0, WORLD_WIDTH - LOGICAL_WIDTH));
  y = clamp(y, 0, Math.max(0, WORLD_HEIGHT - LOGICAL_HEIGHT));
  return { x, y };
}

// ----- Scattered props (simple pixel clusters) -----
const MIN_PLANKS = 30; // ensure wood is available to cross rivers
const props = generateProps(420); // nice scatter count

function generateProps(count) {
  // Deterministic PRNG for consistent layouts per refresh
  let seed = 1337;
  function rand() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    // Convert to [0,1)
    return ((seed >>> 0) / 4294967296);
  }

  const arr = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    let x = 0, y = 0;
    // ensure props spawn on land
    for (let tries = 0; tries < 25; tries++) {
      x = Math.floor(rand() * (WORLD_WIDTH - 8)) + 4;
      y = Math.floor(rand() * (WORLD_HEIGHT - 8)) + 4;
      if (!isWaterAt(x, y)) break;
    }
    // Increase plank (wood) frequency; keep a small chance for walls
    const type = r < 0.25 ? 'rock' : r < 0.50 ? 'bush' : r < 0.70 ? 'flower' : r < 0.90 ? 'plank' : r < 0.94 ? 'wall' : 'pebble';
    arr.push({ x, y, type });
  }
  // Ensure a minimum number of planks exist
  let plankCount = arr.filter(p => p.type === 'plank').length;
  if (plankCount < MIN_PLANKS) {
    for (let i = 0; i < arr.length && plankCount < MIN_PLANKS; i++) {
      if (arr[i].type === 'bush' || arr[i].type === 'pebble' || arr[i].type === 'flower') {
        arr[i].type = 'plank';
        plankCount++;
      }
    }
  }
  return arr;
}

function drawProps(ctx, camX, camY) {
  const viewL = camX - 16, viewT = camY - 16;
  const viewR = camX + LOGICAL_WIDTH + 16;
  const viewB = camY + LOGICAL_HEIGHT + 16;

  for (const p of props) {
    // Early reject outside view
    if (p.x < viewL || p.y < viewT || p.x > viewR || p.y > viewB) continue;

    const sx = Math.round(p.x - camX);
    const sy = Math.round(p.y - camY);

    switch (p.type) {
      case 'rock':
        drawRock(ctx, sx, sy);
        break;
      case 'bush':
        drawBush(ctx, sx, sy);
        break;
      case 'flower':
        drawFlower(ctx, sx, sy);
        break;
      case 'wall':
        drawWallItem(ctx, sx, sy);
        break;
      case 'plank':
        drawPlank(ctx, sx, sy);
        break;
      default:
        drawPebble(ctx, sx, sy);
        break;
    }
  }
}

function drawPropByType(ctx, type, sx, sy) {
  switch (type) {
    case 'rock': return drawRock(ctx, sx, sy);
    case 'bush': return drawBush(ctx, sx, sy);
    case 'flower': return drawFlower(ctx, sx, sy);
    case 'wall': return drawWallItem(ctx, sx, sy);
    case 'plank': return drawPlank(ctx, sx, sy);
    default: return drawPebble(ctx, sx, sy);
  }
}

function drawRock(ctx, x, y) {
  ctx.fillStyle = '#888';
  ctx.fillRect(x - 2, y - 1, 4, 2);
  ctx.fillStyle = '#666';
  ctx.fillRect(x - 1, y - 2, 3, 1);
}

function drawBush(ctx, x, y) {
  ctx.fillStyle = '#2e7d32'; // dark green
  ctx.fillRect(x - 3, y - 2, 6, 2);
  ctx.fillStyle = '#43a047';
  ctx.fillRect(x - 2, y - 3, 4, 1);
}

function drawFlower(ctx, x, y) {
  ctx.fillStyle = '#8e24aa'; // purple
  ctx.fillRect(x, y - 2, 1, 1);
  ctx.fillStyle = '#e53935'; // red
  ctx.fillRect(x - 1, y - 1, 1, 1);
  ctx.fillStyle = '#fb8c00'; // orange
  ctx.fillRect(x + 1, y - 1, 1, 1);
  ctx.fillStyle = '#1e88e5'; // blue
  ctx.fillRect(x, y, 1, 1);
}

function drawPebble(ctx, x, y) {
  ctx.fillStyle = '#999';
  ctx.fillRect(x, y, 1, 1);
}

function drawPlank(ctx, x, y) {
  ctx.fillStyle = '#6d4c41';
  ctx.fillRect(x - 2, y - 1, 5, 2);
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(x - 2, y - 2, 5, 1);
}

function drawWallItem(ctx, x, y) {
  // Small stone block (as inventory/ground item)
  ctx.fillStyle = '#9e9e9e';
  ctx.fillRect(x - 2, y - 2, 5, 4);
  ctx.fillStyle = '#616161';
  ctx.fillRect(x - 2, y - 2, 5, 1);
}

// ---- Interact helpers ----
function nearestPropIndex(x, y, radius) {
  const r2 = radius * radius;
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx*dx + dy*dy;
    if (d2 <= r2 && d2 < bestD2) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

function pickUp(slot) {
  if (inventory[slot]) return; // already occupied
  const idx = nearestPropIndex(player.x, player.y, INTERACT_RADIUS);
  if (idx === -1) return;
  inventory[slot] = props.splice(idx, 1)[0] || null;
}

function placeDown(slot) {
  const item = inventory[slot];
  if (!item) return;
  // Place slightly in front based on facing
  const off = faceOffset(player.face, 8);
  const targetX = clamp(player.x + off.x, 1, WORLD_WIDTH - 1);
  const targetY = clamp(player.y + off.y, 1, WORLD_HEIGHT - 1);
  if (item.type === 'plank') {
    const { tx, ty } = worldToTile(targetX, targetY);
    const id = tIndex(tx, ty);
    if (terrain[id] === 1 && bridges[id] === 0) {
      bridges[id] = 1; // place a bridge tile over water
      inventory[slot] = null;
      return;
    }
  }
  if (item.type === 'wall') {
    // Always place wall under the player's current tile
    const { tx, ty } = worldToTile(player.x, player.y);
    const id = tIndex(tx, ty);
    // Only place on land and if empty of wall
    if (terrain[id] === 0 && walls[id] === 0) {
      // Find a safe adjacent tile to eject the player into before placing
      const eject = findEjectPosition(tx, ty, player.face);
      if (!eject) {
        // No safe spot; cancel placement to avoid trapping
        return;
      }
      walls[id] = 1; // build wall
      // Move player to the safe location
      player.x = eject.x;
      player.y = eject.y;
      inventory[slot] = null; // consume item
      return;
    }
  }
  item.x = targetX;
  item.y = targetY;
  props.push(item);
  inventory[slot] = null;
}

function faceOffset(face, dist) {
  switch (face) {
    case 'left': return { x: -dist, y: 0 };
    case 'right': return { x: dist, y: 0 };
    case 'up': return { x: 0, y: -dist };
    default: return { x: 0, y: dist }; // down
  }
}

// Choose an adjacent tile to move the player into when placing a wall
function findEjectPosition(tx, ty, face) {
  // Order neighbors by facing to feel natural
  const dirsByFace = {
    up:    [ {dx:0,dy:-1}, {dx:-1,dy:0}, {dx:1,dy:0}, {dx:0,dy:1} ],
    down:  [ {dx:0,dy:1},  {dx:1,dy:0},  {dx:-1,dy:0}, {dx:0,dy:-1} ],
    left:  [ {dx:-1,dy:0}, {dx:0,dy:-1}, {dx:0,dy:1}, {dx:1,dy:0} ],
    right: [ {dx:1,dy:0},  {dx:0,dy:1},  {dx:0,dy:-1}, {dx:-1,dy:0} ],
  };
  const order = dirsByFace[face] || dirsByFace.down;
  for (const d of order) {
    const ntx = tx + d.dx;
    const nty = ty + d.dy;
    if (ntx < 0 || nty < 0 || ntx >= GRID_W || nty >= GRID_H) continue;
    // Feet centered on neighbor tile bottom
    const cx = ntx * TILE + TILE / 2;
    const cy = (nty + 1) * TILE;
    if (isWalkableAt(cx, cy) && !rectOverlapsWall(cx, cy)) {
      return { x: cx, y: cy };
    }
  }
  return null;
}

function drawPropHighlight(ctx, p, camX, camY) {
  const sz = propSize(p.type);
  const sx = Math.round(p.x - camX - Math.floor(sz.w / 2));
  const sy = Math.round(p.y - camY - Math.floor(sz.h / 2));
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.strokeRect(sx - 1, sy - 1, sz.w + 2, sz.h + 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.strokeRect(sx, sy, sz.w, sz.h);
}

function propSize(type) {
  switch (type) {
    case 'rock': return { w: 4, h: 3 };
    case 'bush': return { w: 6, h: 3 };
    case 'flower': return { w: 3, h: 3 };
    case 'plank': return { w: 5, h: 3 };
    case 'wall': return { w: 5, h: 4 };
    default: return { w: 1, h: 1 };
  }
}

function drawInventory(ctx) {
  const slotW = 18, slotH = 12;
  const pad = 4;
  const baseX = 6, baseY = LOGICAL_HEIGHT - slotH - 6;
  for (let i = 0; i < 2; i++) {
    const x = baseX + i * (slotW + pad);
    const y = baseY;
    // background
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, slotW, slotH);
    ctx.strokeStyle = i === activeSlot ? '#111' : 'rgba(0,0,0,0.4)';
    ctx.strokeRect(x + 0.5, y + 0.5, slotW - 1, slotH - 1);
    // item preview centered
    const item = inventory[i];
    if (item) {
      const cx = Math.round(x + slotW / 2);
      const cy = Math.round(y + slotH / 2);
      drawPropByType(ctx, item.type, cx, cy);
    }
    // slot number indicator
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 1, y + slotH + 1, 6, 3);
    ctx.fillStyle = '#fff';
    if (i === 0) ctx.fillRect(x, y + slotH + 2, 1, 1); else ctx.fillRect(x + 2, y + slotH + 2, 1, 1);
  }
}

// ----- Crafting (combine both inventory slots) -----
const RECIPES = {
  // two bushes -> plank (wood)
  'bush+bush': { output: 'plank' },
  // two rocks -> wall
  'rock+rock': { output: 'wall' },
};

function tryCraft() {
  const a = inventory[0];
  const b = inventory[1];
  if (!a || !b) return false;
  const key = craftKey(a.type, b.type);
  const recipe = RECIPES[key];
  if (!recipe) return false;

  // consume inputs
  inventory[0] = null;
  inventory[1] = null;

  const result = { type: recipe.output, x: player.x, y: player.y };
  // place result in first free slot, else drop
  if (!inventory[0]) inventory[0] = result;
  else if (!inventory[1]) inventory[1] = result;
  else props.push(result);
  return true;
}

function craftKey(a, b) {
  return [a, b].sort().join('+');
}

// ---- Wall removal (press E 5 times) ----
const REQUIRED_WALL_PRESSES = 5;
let wallPresses = 0;
let lastWallTarget = -1;
let lastWallPressAt = 0;

function nearestWallTileInRadius(x, y, radius) {
  const rTiles = Math.ceil(radius / TILE) + 1;
  const { tx: cx, ty: cy } = worldToTile(x, y);
  let best = null;
  let bestD2 = Infinity;
  for (let ty = cy - rTiles; ty <= cy + rTiles; ty++) {
    if (ty < 0 || ty >= GRID_H) continue;
    for (let tx = cx - rTiles; tx <= cx + rTiles; tx++) {
      if (tx < 0 || tx >= GRID_W) continue;
      const id = tIndex(tx, ty);
      if (walls[id] !== 1) continue;
      const cxw = tx * TILE + TILE / 2;
      const cyw = ty * TILE + TILE / 2;
      const dx = cxw - x, dy = cyw - y;
      const d2 = dx*dx + dy*dy;
      if (d2 <= radius*radius && d2 < bestD2) {
        bestD2 = d2;
        best = { tx, ty, id };
      }
    }
  }
  return best;
}

function tryWallRemovalPress() {
  const target = nearestWallTileInRadius(player.x, player.y, INTERACT_RADIUS);
  if (!target) return false;
  const now = performance.now();
  if (target.id === lastWallTarget && (now - lastWallPressAt) < 1500) {
    wallPresses += 1;
  } else {
    wallPresses = 1;
    lastWallTarget = target.id;
  }
  lastWallPressAt = now;

  if (wallPresses >= REQUIRED_WALL_PRESSES) {
    // Remove wall and drop an item
    walls[target.id] = 0;
    props.push({ type: 'wall', x: target.tx * TILE + TILE / 2, y: target.ty * TILE + TILE / 2 });
    wallPresses = 0;
    lastWallTarget = -1;
  }
  return true; // consumed the E press
}

function drawWallHighlight(ctx, tx, ty, camX, camY, presses, required) {
  const sx = tx * TILE - camX;
  const sy = ty * TILE - camY;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeRect(Math.round(sx)-1, Math.round(sy)-1, TILE+2, TILE+2);
  // progress bar
  const w = Math.max(0, Math.min(TILE, Math.round((presses / required) * TILE)));
  ctx.fillStyle = 'rgba(66,66,66,0.6)';
  ctx.fillRect(Math.round(sx), Math.round(sy) - 3, w, 2);
}

function drawTerrain(ctx, camX, camY) {
  const startTX = Math.max(0, Math.floor(camX / TILE));
  const startTY = Math.max(0, Math.floor(camY / TILE));
  const endTX = Math.min(GRID_W - 1, Math.floor((camX + LOGICAL_WIDTH) / TILE) + 1);
  const endTY = Math.min(GRID_H - 1, Math.floor((camY + LOGICAL_HEIGHT) / TILE) + 1);
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      if (terrain[tIndex(tx, ty)] !== 1) continue;
      const sx = tx * TILE - camX;
      const sy = ty * TILE - camY;
      ctx.fillStyle = '#b3e5fc';
      ctx.fillRect(Math.round(sx), Math.round(sy), TILE, TILE);
    }
  }
}

function drawBridges(ctx, camX, camY) {
  const startTX = Math.max(0, Math.floor(camX / TILE));
  const startTY = Math.max(0, Math.floor(camY / TILE));
  const endTX = Math.min(GRID_W - 1, Math.floor((camX + LOGICAL_WIDTH) / TILE) + 1);
  const endTY = Math.min(GRID_H - 1, Math.floor((camY + LOGICAL_HEIGHT) / TILE) + 1);
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      const id = tIndex(tx, ty);
      if (bridges[id] !== 1) continue;
      const sx = tx * TILE - camX;
      const sy = ty * TILE - camY;
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(Math.round(sx), Math.round(sy + TILE/3), TILE, Math.ceil(TILE/3));
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(Math.round(sx), Math.round(sy + TILE/3 - 1), TILE, 1);
    }
  }
}

function drawWalls(ctx, camX, camY) {
  const startTX = Math.max(0, Math.floor(camX / TILE));
  const startTY = Math.max(0, Math.floor(camY / TILE));
  const endTX = Math.min(GRID_W - 1, Math.floor((camX + LOGICAL_WIDTH) / TILE) + 1);
  const endTY = Math.min(GRID_H - 1, Math.floor((camY + LOGICAL_HEIGHT) / TILE) + 1);
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      const id = tIndex(tx, ty);
      if (walls[id] !== 1) continue;
      const sx = tx * TILE - camX;
      const sy = ty * TILE - camY;
      // Stone block fill
      ctx.fillStyle = '#9e9e9e';
      ctx.fillRect(Math.round(sx), Math.round(sy), TILE, TILE);
      // darker top edge
      ctx.fillStyle = '#616161';
      ctx.fillRect(Math.round(sx), Math.round(sy), TILE, 1);
      // outline
      ctx.strokeStyle = '#424242';
      ctx.strokeRect(Math.round(sx)+0.5, Math.round(sy)+0.5, TILE-1, TILE-1);
    }
  }
}
