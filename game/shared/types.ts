// Shared types for the game

export interface Player {
  id: string;
  x: number; // Decimal position: integer part = tile, decimal part = position within tile
  y: number;
  color: string;
}

export interface GameConfig {
  TILE_SIZE: number;
  WORLD_WIDTH: number;   // Total world size in tiles
  WORLD_HEIGHT: number;  // Total world size in tiles
  VIEWPORT_WIDTH: number;  // Visible area in tiles
  VIEWPORT_HEIGHT: number; // Visible area in tiles
  MOVE_SPEED: number; // Movement speed per frame
}

export interface ServerToClientEvents {
  'player:new': (player: Player) => void;
  'player:update': (player: Player) => void;
  'player:remove': (id: string) => void;
  'self': (id: string) => void;
}

export interface ClientToServerEvents {
  move: (deltaX: number, deltaY: number) => void;
}
