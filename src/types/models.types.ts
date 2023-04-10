export class Judgments {
  fantasticPlus: number;
  fantastics: number;
  excellents: number;
  greats: number;
  decents?: number;
  wayOffs?: number;
  misses: number;
}

export class Player {
  playerId: string;
  profileName: string;

  judgments?: Judgments;

  // Scores are recalculates as the the judgments come in.
  score?: number;
  exScore?: number;
}

export class Spectator {
  profileName?: string;
}

export class Lobby {
  code: string;
  // Empty string here is equivalent to "no password".
  password: string;
  players: Record<string, Player>;
  spectators: Spectator[];
}

export class LobbyInfo {
  code: string;
  numberPlayers: number;
}

export class LOBBYMAN {
  static lobbies: Record<string, Lobby>;
  // Mapping from playerId to the lobby code they're in.
  static activePlayers: Record<string, string>;
}
