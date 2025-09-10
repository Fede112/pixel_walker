import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Player, ServerToClientEvents, ClientToServerEvents } from 'shared/types';


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
  const color = `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`;
  players[socket.id] = { id: socket.id, x: 100, y: 100, color };
  io.emit('players', Object.values(players));

  socket.on('move', (x, y) => {
    if (players[socket.id]) {
      players[socket.id].x = x;
      players[socket.id].y = y;
      io.emit('players', Object.values(players));
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('players', Object.values(players));
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
