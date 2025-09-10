import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
const socket = io('http://localhost:3000');
const app = new PIXI.Application({ width: 800, height: 600, backgroundColor: 0x222222 });
document.body.appendChild(app.view);
let players = [];
socket.on('players', (serverPlayers) => {
    players = serverPlayers;
});
app.ticker.add(() => {
    app.stage.removeChildren();
    for (const player of players) {
        const g = new PIXI.Graphics();
        g.beginFill(PIXI.utils.string2hex(player.color));
        g.drawCircle(player.x, player.y, 15);
        g.endFill();
        app.stage.addChild(g);
    }
});
// Move local player with mouse
app.view.addEventListener('pointermove', (e) => {
    const rect = app.view.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    socket.emit('move', x, y);
});
