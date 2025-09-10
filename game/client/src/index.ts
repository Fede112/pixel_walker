import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
import type { Player, GameConfig } from 'shared/types';

const CONFIG: GameConfig = {
  TILE_SIZE: 32,
  WORLD_WIDTH: 100,    // Large world: 100x100 tiles
  WORLD_HEIGHT: 100,
  VIEWPORT_WIDTH: 25,  // Visible area: 25x19 tiles
  VIEWPORT_HEIGHT: 19,
  MOVE_SPEED: 0.1 // tiles per frame (reduced for smooth continuous movement)
};

class PlayerSprite {
  public gfx: PIXI.Graphics;
  public x: number; // Decimal position (tile + fractional)
  public y: number;

  constructor(public id: string, public color: string, startX: number, startY: number) {
    this.gfx = new PIXI.Graphics();
    this.gfx.beginFill(PIXI.utils.string2hex(color));
    this.gfx.drawRect(-CONFIG.TILE_SIZE / 2, -CONFIG.TILE_SIZE / 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
    this.gfx.endFill();
    
    this.x = startX;
    this.y = startY;
    this.updateVisualPosition();
  }

  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.updateVisualPosition();
  }

  private updateVisualPosition() {
    // Convert decimal position to pixel position
    this.gfx.x = this.x * CONFIG.TILE_SIZE;
    this.gfx.y = this.y * CONFIG.TILE_SIZE;
  }

  getCurrentTile(): { tileX: number, tileY: number } {
    return {
      tileX: Math.floor(this.x),
      tileY: Math.floor(this.y)
    };
  }
}

class Game {
  private app: PIXI.Application;
  private socket = io('http://localhost:3000');
  private players: Map<string, PlayerSprite> = new Map();
  private selfId: string | null = null;
  private keysPressed: Set<string> = new Set();
  private worldContainer: PIXI.Container;
  private camera: { x: number, y: number } = { 
    x: (CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE - CONFIG.VIEWPORT_WIDTH * CONFIG.TILE_SIZE) / 2, 
    y: (CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE - CONFIG.VIEWPORT_HEIGHT * CONFIG.TILE_SIZE) / 2 
  };

  constructor() {
    // Create app with viewport size (visible area)
    this.app = new PIXI.Application({ 
      width: CONFIG.VIEWPORT_WIDTH * CONFIG.TILE_SIZE, 
      height: CONFIG.VIEWPORT_HEIGHT * CONFIG.TILE_SIZE, 
      backgroundColor: 0x228B22 
    });
    document.body.appendChild(this.app.view as HTMLCanvasElement);

    // World container holds all game objects and can be moved for camera
    this.worldContainer = new PIXI.Container();
    this.app.stage.addChild(this.worldContainer);
    
    // Initialize world container position to match camera
    this.worldContainer.x = -this.camera.x;
    this.worldContainer.y = -this.camera.y;

    this.drawGrid();
    this.setupInput();

    this.socket.on('self', (id: string) => { 
      console.log(`I am player: ${id}`);
      this.selfId = id;
      
      // Update camera immediately in case the player sprite already exists
      if (this.players.has(id)) {
        console.log(`Self player sprite already exists, updating camera`);
        this.updateCamera();
      }
    });
    this.socket.on('player:new', (player: Player) => {
      console.log(`New player joined: ${player.id} at (${player.x}, ${player.y})`);
      this.addPlayer(player);
    });
    this.socket.on('player:update', (player: Player) => 
      this.updatePlayer(player.id, player.x, player.y));
    this.socket.on('player:remove', (id: string) => {
      console.log(`Player left: ${id}`);
      this.removePlayer(id);
    });

    this.app.ticker.add(() => this.update());
  }

  private drawGrid() {
    const gridGraphics = new PIXI.Graphics();
    gridGraphics.lineStyle(1, 0x404040, 0.3);
    
    // Draw grid for the entire world
    for (let x = 0; x <= CONFIG.WORLD_WIDTH; x++) {
      gridGraphics.moveTo(x * CONFIG.TILE_SIZE, 0);
      gridGraphics.lineTo(x * CONFIG.TILE_SIZE, CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE);
    }
    
    for (let y = 0; y <= CONFIG.WORLD_HEIGHT; y++) {
      gridGraphics.moveTo(0, y * CONFIG.TILE_SIZE);
      gridGraphics.lineTo(CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE, y * CONFIG.TILE_SIZE);
    }
    
    this.worldContainer.addChild(gridGraphics);
  }

  private setupInput() {
    window.addEventListener('keydown', (e) => {
      this.keysPressed.add(e.code);
    });
    
    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.code);
    });
  }

  private handleInput() {
    if (!this.selfId) return;

    const selfSprite = this.players.get(this.selfId);
    if (!selfSprite) return;

    let deltaX = 0;
    let deltaY = 0;

    // Check all movement keys
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) {
      deltaY -= 1;
    }
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) {
      deltaY += 1;
    }
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) {
      deltaX -= 1;
    }
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) {
      deltaX += 1;
    }

    // Normalize diagonal movement to prevent faster diagonal speed
    if (deltaX !== 0 && deltaY !== 0) {
      const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      deltaX = (deltaX / length) * CONFIG.MOVE_SPEED;
      deltaY = (deltaY / length) * CONFIG.MOVE_SPEED;
    } else {
      deltaX *= CONFIG.MOVE_SPEED;
      deltaY *= CONFIG.MOVE_SPEED;
    }

    if (deltaX !== 0 || deltaY !== 0) {
      // Apply bounds checking for the world
      const newX = Math.max(0.1, Math.min(CONFIG.WORLD_WIDTH - 0.1, selfSprite.x + deltaX));
      const newY = Math.max(0.1, Math.min(CONFIG.WORLD_HEIGHT - 0.1, selfSprite.y + deltaY));
      
      // Update local player immediately for responsiveness
      selfSprite.setPosition(newX, newY);
      
      // Update camera to follow player
      this.updateCamera();
      
      this.socket.emit('move', deltaX, deltaY);
    }
  }

  private addPlayer(player: Player) {
    if (!this.players.has(player.id)) {
      console.log(`Adding player sprite for ${player.id} at (${player.x}, ${player.y})`);
      const sprite = new PlayerSprite(player.id, player.color, player.x, player.y);
      this.players.set(player.id, sprite);
      this.worldContainer.addChild(sprite.gfx);
      console.log(`Total players now: ${this.players.size}`);
      
      // If this is the self player, update camera immediately
      if (player.id === this.selfId) {
        console.log(`This is self player, updating camera`);
        this.updateCamera();
      }
    } else {
      console.log(`Player ${player.id} already exists, skipping add`);
    }
  }

  private updatePlayer(id: string, x: number, y: number) {
    const sprite = this.players.get(id);
    if (sprite) {
      // Don't update self player from server (we update locally for responsiveness)
      if (id === this.selfId) return;
      
      // Update other players' positions
      sprite.setPosition(x, y);
    }
  }

  private removePlayer(id: string) {
    const sprite = this.players.get(id);
    if (sprite) {
      this.worldContainer.removeChild(sprite.gfx);
      this.players.delete(id);
    }
  }

  private updateCamera() {
    if (!this.selfId) {
      console.log(`UpdateCamera: no selfId yet`);
      return;
    }
    
    const selfSprite = this.players.get(this.selfId);
    if (!selfSprite) {
      console.log(`UpdateCamera: no selfSprite found for ${this.selfId}`);
      return;
    }

    // Calculate target camera position (center player on screen)
    const targetCameraX = (selfSprite.x * CONFIG.TILE_SIZE) - (CONFIG.VIEWPORT_WIDTH * CONFIG.TILE_SIZE) / 2;
    const targetCameraY = (selfSprite.y * CONFIG.TILE_SIZE) - (CONFIG.VIEWPORT_HEIGHT * CONFIG.TILE_SIZE) / 2;

    // Clamp camera to world bounds
    const maxCameraX = (CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE) - (CONFIG.VIEWPORT_WIDTH * CONFIG.TILE_SIZE);
    const maxCameraY = (CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE) - (CONFIG.VIEWPORT_HEIGHT * CONFIG.TILE_SIZE);

    const oldCameraX = this.camera.x;
    const oldCameraY = this.camera.y;

    this.camera.x = Math.max(0, Math.min(maxCameraX, targetCameraX));
    this.camera.y = Math.max(0, Math.min(maxCameraY, targetCameraY));

    // Move the world container to simulate camera movement
    this.worldContainer.x = -this.camera.x;
    this.worldContainer.y = -this.camera.y;
  }

  private update() {
    // Handle continuous input (every frame)
    this.handleInput();

    // Highlight self player and show current tile info
    for (const [id, sprite] of this.players) {
      if (id === this.selfId) {
        sprite.gfx.lineStyle(3, 0xffffff);
        // Optional: show which tile the player is in
        const tile = sprite.getCurrentTile();
        // console.log(`Player at tile (${tile.tileX}, ${tile.tileY}), position (${sprite.x.toFixed(2)}, ${sprite.y.toFixed(2)})`);
      } else {
        sprite.gfx.lineStyle(0);
      }
    }
  }
}

new Game();
