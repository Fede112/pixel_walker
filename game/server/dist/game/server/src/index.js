import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
const CONFIG = {
    WORLD_WIDTH: 1200,
    WORLD_HEIGHT: 800,
    TILE: 8,
};
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
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
// terrain: 0 land, 1 water
const terrain = new Uint8Array(GRID_W * GRID_H);
const props = new Map();
const bridges = new Map();
const walls = new Map();
const bridgeByTile = new Map();
const wallByTile = new Map();
function key(tx, ty) { return `${tx},${ty}`; }
let idSeq = 1;
function genId(prefix) { return `${prefix}${idSeq++}`; }
let worldSeed = 2025;
function wrand() {
    worldSeed ^= worldSeed << 13;
    worldSeed ^= worldSeed >>> 17;
    worldSeed ^= worldSeed << 5;
    return ((worldSeed >>> 0) / 4294967296);
}
function tIndex(tx, ty) { return ty * GRID_W + tx; }
function generateRivers() {
    terrain.fill(0);
    const rivers = 2 + Math.floor(wrand() * 2);
    for (let r = 0; r < rivers; r++) {
        let y = Math.floor(wrand() * GRID_H);
        let width = 2 + Math.floor(wrand() * 2);
        for (let x = 0; x < GRID_W; x++) {
            y += (wrand() - 0.5) * 1.3;
            if (y < 1)
                y = 1;
            if (y > GRID_H - 2)
                y = GRID_H - 2;
            const cy = Math.round(y);
            for (let wy = -width; wy <= width; wy++) {
                const ty = cy + wy;
                if (ty < 0 || ty >= GRID_H)
                    continue;
                terrain[tIndex(x, ty)] = 1;
            }
        }
    }
}
function generateProps(count) {
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
            if (terrain[tIndex(tx, ty)] === 0)
                break; // land only
        }
        let type = r < 0.25 ? 'rock' : r < 0.50 ? 'bush' : r < 0.70 ? 'flower' : r < 0.90 ? 'plank' : r < 0.94 ? 'wall' : 'pebble';
        if (type === 'plank')
            plankCount++;
        const id = genId('p');
        props.set(id, { id, x, y, type });
    }
    const MIN_PLANKS = 30;
    if (plankCount < MIN_PLANKS) {
        for (const p of props.values()) {
            if (plankCount >= MIN_PLANKS)
                break;
            if (p.type === 'bush' || p.type === 'pebble' || p.type === 'flower') {
                p.type = 'plank';
                plankCount++;
            }
        }
    }
}
function buildSnapshot() {
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
function distance2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
}
// Initialize world once
generateRivers();
generateProps(420);
const players = {};
io.on('connection', (socket) => {
    console.log(`Player ${socket.id} connected`);
    const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
    // Send existing players to new client
    for (const player of Object.values(players)) {
        socket.emit('player:new', player);
    }
    // Send world snapshot to new client
    socket.emit('world:init', buildSnapshot());
    // Create new player - spawn at center of world (pixel coordinates)
    const startX = Math.floor(CONFIG.WORLD_WIDTH / 2);
    const startY = Math.floor(CONFIG.WORLD_HEIGHT / 2);
    const newPlayer = {
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
        if (!player)
            return;
        // Apply movement with bounds checking for the world
        const newX = Math.max(0.1, Math.min(CONFIG.WORLD_WIDTH - 0.1, player.x + deltaX));
        const newY = Math.max(0.1, Math.min(CONFIG.WORLD_HEIGHT - 0.1, player.y + deltaY));
        player.x = newX;
        player.y = newY;
        socket.broadcast.emit('player:update', player);
    });
    // ----- World actions -----
    socket.on('prop:pickup', (propId) => {
        const player = players[socket.id];
        if (!player)
            return;
        const p = props.get(propId);
        if (!p)
            return;
        if (distance2(player.x, player.y, p.x, p.y) > INTERACT_RADIUS * INTERACT_RADIUS)
            return;
        props.delete(propId);
        io.emit('prop:removed', { id: propId, type: p.type, by: socket.id });
    });
    socket.on('bridge:place', (tx, ty) => {
        if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H)
            return;
        const idKey = key(tx, ty);
        if (bridgeByTile.has(idKey))
            return;
        if (terrain[tIndex(tx, ty)] !== 1)
            return; // only on water
        const id = genId('b');
        const item = { id, tx, ty, by: socket.id };
        bridges.set(id, item);
        bridgeByTile.set(idKey, id);
        io.emit('bridge:placed', item);
    });
    socket.on('wall:place', (tx, ty) => {
        if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H)
            return;
        const idKey = key(tx, ty);
        if (wallByTile.has(idKey))
            return;
        if (terrain[tIndex(tx, ty)] !== 0)
            return; // only on land
        const id = genId('w');
        const item = { id, tx, ty, by: socket.id };
        walls.set(id, item);
        wallByTile.set(idKey, id);
        io.emit('wall:placed', item);
    });
    socket.on('wall:remove', (tx, ty) => {
        if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H)
            return;
        const idKey = key(tx, ty);
        const id = wallByTile.get(idKey);
        if (!id)
            return;
        walls.delete(id);
        wallByTile.delete(idKey);
        io.emit('wall:removed', id);
    });
    socket.on('prop:drop', (type, x, y) => {
        // Basic validation: near player and inside world
        const player = players[socket.id];
        if (!player)
            return;
        if (x < 0 || y < 0 || x > CONFIG.WORLD_WIDTH || y > CONFIG.WORLD_HEIGHT)
            return;
        if (distance2(player.x, player.y, x, y) > INTERACT_RADIUS * INTERACT_RADIUS * 4)
            return;
        const id = genId('p');
        const p = { id, x: Math.round(x), y: Math.round(y), type };
        props.set(id, p);
        io.emit('prop:added', { id, type, x: p.x, y: p.y, by: socket.id });
    });
    socket.on('disconnect', () => {
        console.log(`Player ${socket.id} disconnected`);
        delete players[socket.id];
        io.emit('player:remove', socket.id);
    });
});
// API routes
import { pixelArtRouter } from './routes/pixelart';
app.use('/api/pixelart', pixelArtRouter);
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
