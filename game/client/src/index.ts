import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
import type { Player } from 'shared/types';

class PlayerDot {
  public gfx: PIXI.Graphics;
  constructor(public id: string, public color: string) {
    this.gfx = new PIXI.Graphics();
    this.gfx.beginFill(PIXI.utils.string2hex(color));
    this.gfx.drawCircle(0, 0, 15);
    this.gfx.endFill();
  }
  setPosition(x: number, y: number) {
    this.gfx.x = x;
    this.gfx.y = y;
  }
}

class Game {
  private app: PIXI.Application;
  private socket = io('http://localhost:3000');
  private playerDots: Map<string, PlayerDot> = new Map();
  private selfId: string | null = null;

  constructor() {
    this.app = new PIXI.Application({ width: 800, height: 600, backgroundColor: 0x222222 });
    document.body.appendChild(this.app.view as HTMLCanvasElement);

    this.socket.on('self', (id: string) => { this.selfId = id; });
    this.socket.on('player:new', (player: Player) => this.addPlayer(player));
    this.socket.on('player:update', (id: string, x: number, y: number) => this.updatePlayer(id, x, y));
    this.socket.on('player:remove', (id: string) => this.removePlayer(id));

    this.app.ticker.add(() => this.render());

    this.app.view?.addEventListener('pointermove', (e) => this.handlePointerMove(e as PointerEvent));
  }

  private addPlayer(player: Player) {
    if (!this.playerDots.has(player.id)) {
      const dot = new PlayerDot(player.id, player.color);
      dot.setPosition(player.x, player.y);
      this.playerDots.set(player.id, dot);
      this.app.stage.addChild(dot.gfx);
    }
  }

  private updatePlayer(id: string, x: number, y: number) {
    const dot = this.playerDots.get(id);
    if (dot) {
      dot.setPosition(x, y);
    }
    if(this.selfId !== id) {
      console.log("Move player",  x, y);
    }
  }

  private removePlayer(id: string) {
    const dot = this.playerDots.get(id);
    if (dot) {
      this.app.stage.removeChild(dot.gfx);
      this.playerDots.delete(id);
    }
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.app.view) return;
    const rect = this.app.view.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (this.selfId) {
      this.updatePlayer(this.selfId, x, y);
    }

    this.socket.emit('move', x, y);
  }

  private render() {
    for (const [id, dot] of this.playerDots) {
      if (id === this.selfId) {
        dot.gfx.lineStyle(3, 0xffffff);
      } else {
        dot.gfx.lineStyle(0);
      }
    }
  }
}

new Game();
