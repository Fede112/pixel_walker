import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
import type { Player, ServerToClientEvents, ClientToServerEvents } from 'shared/types';

const socket = io('http://localhost:3000');

const app = new PIXI.Application({ width: 800, height: 600, backgroundColor: 0x222222 });
document.body.appendChild(app.view as HTMLCanvasElement);

let players: Player[] = [];

socket.on('players', (serverPlayers) => {
  players = serverPlayers;
});

app.ticker.add(() => {
  app.stage.removeChildren();
  for (const player of players) {
    const g = new PIXI.Graphics();
    g.beginFill(new PIXI.Color(player.color).toNumber());
    g.drawCircle(player.x, player.y, 15);
    g.endFill();
    app.stage.addChild(g);
  }
});

// Move local player with mouse
const canvas = app.view as HTMLCanvasElement;
canvas.addEventListener('pointermove', (e: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  socket.emit('move', x, y);
});
