// Shared types for the game (server-authoritative world)

export type ItemCategory = 'terrain' | 'transport' | 'construction' | 'food' | 'weapon' | 'tool' | 'fauna';

export type PropType = 'rock' | 'bush' | 'flower' | 'plank' | 'wall' | 'pebble';

// Base item interface
export interface BaseItem {
  id: string;
  name: string;
  category: ItemCategory;
  description: string;
  sprite: string;
}

// Category-specific item types
export interface TerrainItem extends BaseItem {
  category: 'terrain';
  walkable: boolean;
  buildable_on: boolean;
  durability: number; // -1 for indestructible
}

export interface TransportItem extends BaseItem {
  category: 'transport';
  speed_bonus: number;
  capacity: number; // -1 for unlimited
  fuel_type: string | null;
}

export interface ConstructionItem extends BaseItem {
  category: 'construction';
  strength: number;
  weather_resistance: number;
  build_time: number;
}

export interface FoodItem extends BaseItem {
  category: 'food';
  nutrition: number;
  hunger_restore: number;
  spoil_time: number; // seconds
}

export interface WeaponItem extends BaseItem {
  category: 'weapon';
  damage: number;
  range: number;
  durability: number;
  attack_speed: number;
}

export interface ToolItem extends BaseItem {
  category: 'tool';
  efficiency: number;
  durability: number;
  tool_type: string;
}

export interface FaunaItem extends BaseItem {
  category: 'fauna';
  health: number;
  behavior: string;
  drops: string[];
  spawn_biome: string[];
}

export type Item = TerrainItem | TransportItem | ConstructionItem | FoodItem | WeaponItem | ToolItem | FaunaItem;

// Recipe system
export interface RecipeInput {
  item_id: string;
  quantity: number;
}

export interface RecipeOutput {
  item_id: string;
  quantity: number;
}

export interface Recipe {
  id: string;
  name: string;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  craft_time: number;
  skill_required: string | null;
  tools_required: string[];
}

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

  // Item database sync
  'items:sync': (items: Record<string, Item>) => void;
  'items:update': (items: Record<string, Item>) => void;

  // Crafting
  'craft:result': (success: boolean, result?: { item_id: string; quantity: number }) => void;
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

  // Crafting
  'craft:request': (inputs: { item_id: string; quantity: number }[]) => void;
}
