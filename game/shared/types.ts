// Shared types for the game

export interface Player {
  id: string;
  x: number;
  y: number;
  color: string;
}

export interface ServerToClientEvents {
  'player:new': (player: Player) => void;
  'player:update': (id: string, x: number, y: number) => void;
  'player:remove': (id: string) => void;
  'self': (id: string) => void;
}

export interface ClientToServerEvents {
  move: (x: number, y: number) => void;
}
