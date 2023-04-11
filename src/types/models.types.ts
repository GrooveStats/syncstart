import { SocketId } from 'socket.io-adapter';

export class Judgments {
  fantasticPlus: number;
  fantastics: number;
  excellents: number;
  greats: number;
  decents?: number;
  wayOffs?: number;
  misses: number;
  totalSteps: number;
  minesHit: number;
  totalMines: number;
  holdsHeld: number;
  totalHolds: number;
  rollsHeld: number;
  totalRolls: number;
}

export class Player {
  playerId: string;
  profileName: string;

  // Provided by each player.
  judgments?: Judgments;
  score?: number;
  exScore?: number;
}

export class Spectator {
  profileName?: string;
}

export class SongInfo {
  // The path for the song on a player's filesystem.
  // We'll use this as a key for other players to play.
  // e.g. 5guys1pack/Earthquake
  //
  // NOTE(teejusb): This requires all connected players to have those packs on
  // their machine.
  //
  // NOTE(teejusb): We want to allow players to play the same *song* even if
  // they may be different difficulties. Using a chartHash or similar is not
  // sufficient in that case. Additionally, StepMania doesn't currently have a
  // way to jump to a specific song based only on it's chart (as there may be
  // conflicts). As a result, players that split up/rename the pack will not be
  // able easily play with players that don't as the songPaths will be
  // different.
  songPath: string;
  title: string;
  artist: string;
  stepartist: string;
  songLength: number;
}

export class Lobby {
  code: string;
  // Empty string here is equivalent to "no password".
  password: string;
  players: Record<string, Player>;
  spectators: Spectator[];

  songInfo?: SongInfo;

  // All connected socketIds. This will include all the socketIds for both
  // players and spectators. Note that more than one player may be connected for
  // each client.
  connectedSocketIds: Set<SocketId>;
}

export class LobbyInfo {
  code: string;
  isPasswordProtected: boolean;
  playerCount: number;
}

export class LOBBYMAN {
  static lobbies: Record<string, Lobby>;
  // Mapping from playerId to the lobby code they're in.
  static activePlayers: Record<string, string>;
}
