// Simple Express + Socket.IO server to host the game and sync players
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files (index.html, src/*, etc.)
app.use(express.static(path.join(__dirname)));

// In-memory player state. In production you’d use a store.
// { socketId: { x,y,face,stepIndex,width,height } }
const players = Object.create(null);

io.on('connection', (socket) => {
  // Provide current players snapshot to the newly connected client
  socket.emit('players', players);

  // Register this player with a temporary default; client will immediately send a move
  players[socket.id] = { x: 0, y: 0, face: 'down', stepIndex: 0 };

  // Tell everyone a player joined (no position yet); client updates after first move
  socket.broadcast.emit('playerJoined', { id: socket.id, ...players[socket.id] });

  socket.on('move', (state) => {
    // Basic validation and clamp
    if (!state || typeof state.x !== 'number' || typeof state.y !== 'number') return;
    players[socket.id] = {
      x: Math.round(state.x),
      y: Math.round(state.y),
      face: state.face || 'down',
      stepIndex: state.stepIndex | 0,
    };
    // Broadcast to all others
    socket.broadcast.emit('playerMoved', { id: socket.id, ...players[socket.id] });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    socket.broadcast.emit('playerLeft', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Game server on http://localhost:${PORT}`);
});

