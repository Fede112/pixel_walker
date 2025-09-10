// Shared types for the game

export interface Player {
  id: string;
  x: number;
  y: number;
  color: string;
}

export interface ServerToClientEvents {
  players: (players: Player[]) => void;
}

export interface ClientToServerEvents {
  move: (x: number, y: number) => void;
}
