// Shared types for the game (server-authoritative world)

export type PropType = 'rock' | 'bush' | 'flower' | 'plank' | 'wall' | 'pebble';

export interface Player {
  id: string;
  x: number; // world pixel coordinates
  y: number;
  color: string;
}

export interface WorldConfig {
  WORLD_WIDTH: number;   // world size in pixels
  WORLD_HEIGHT: number;  // world size in pixels
  TILE: number;          // tile size in pixels
}

export interface Prop {
  id: string;
  x: number;
  y: number;
  type: PropType;
}

export interface TileItem {
  id: string;
  tx: number;
  ty: number;
  by?: string; // actor id (optional)
}

export interface WorldSnapshot {
  config: WorldConfig;
  gridW: number; // tiles width
  gridH: number; // tiles height
  terrain: number[]; // 0 land, 1 water; flat array length gridW*gridH
  props: Prop[];
  bridges: TileItem[];
  walls: TileItem[];
}

export interface ServerToClientEvents {
  // Players
  'player:new': (player: Player) => void;
  'player:update': (player: Player) => void;
  'player:remove': (id: string) => void;
  'self': (id: string) => void;

  // World
  'world:init': (snapshot: WorldSnapshot) => void;
  'prop:removed': (data: { id: string; type: PropType; by: string }) => void;
  'prop:added': (data: { id: string; type: PropType; x: number; y: number; by: string }) => void;
  'bridge:placed': (item: TileItem) => void;
  'wall:placed': (item: TileItem) => void;
  'wall:removed': (id: string) => void;
}

export interface ClientToServerEvents {
  // Movement
  move: (deltaX: number, deltaY: number) => void;

  // World actions
  'prop:pickup': (propId: string) => void;
  'prop:drop': (type: PropType, x: number, y: number) => void;
  'bridge:place': (tx: number, ty: number) => void;
  'wall:place': (tx: number, ty: number) => void;
  'wall:remove': (tx: number, ty: number) => void;
}
