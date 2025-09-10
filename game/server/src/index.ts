import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Player, ServerToClientEvents, ClientToServerEvents, GameConfig } from 'shared/types';

const CONFIG: GameConfig = {
  TILE_SIZE: 32,
  WORLD_WIDTH: 100,    // Large world: 100x100 tiles
  WORLD_HEIGHT: 100,
  VIEWPORT_WIDTH: 25,  // Visible area: 25x19 tiles
  VIEWPORT_HEIGHT: 19,
  MOVE_SPEED: 0.1 // tiles per frame (consistent with client)
};


import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' }
});

// Serve static files from the client/dist directory
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

const players: Record<string, Player> = {};

io.on('connection', (socket) => {
  console.log(`Player ${socket.id} connected`);
  const color = `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`;

  // Send existing players to new client
  for (const player of Object.values(players)) {
    socket.emit('player:new', player);
  }

  // Create new player - spawn at center of world (using decimal coordinates)
  const startX = Math.floor(CONFIG.WORLD_WIDTH / 2) + 0.5; // Center of tile
  const startY = Math.floor(CONFIG.WORLD_HEIGHT / 2) + 0.5;
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

    // Apply movement with bounds checking for the world
    const newX = Math.max(0.1, Math.min(CONFIG.WORLD_WIDTH - 0.1, player.x + deltaX));
    const newY = Math.max(0.1, Math.min(CONFIG.WORLD_HEIGHT - 0.1, player.y + deltaY));
    
    player.x = newX;
    player.y = newY;
    
    socket.broadcast.emit('player:update', player);
  });


  socket.on('disconnect', () => {
    console.log(`Player ${socket.id} disconnected`);
    delete players[socket.id];
    io.emit('player:remove', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
