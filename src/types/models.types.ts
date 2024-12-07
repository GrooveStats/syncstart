export type SocketId = string;

export type LobbyCode = string;

export interface Judgments {
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

export interface Spectator {
  profileName: string;
  socketId?: SocketId;
}

export interface SongInfo {
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
  // able easily play with players that don't, as the songPaths will be
  // different.
  songPath: string;
  title: string;
  artist: string;
  stepartist: string;
  songLength: number;
}

export interface Player {
  playerId: string;
  profileName: string;

  judgments?: Judgments;
  score?: number;
  exScore?: number;
}

export interface Machine {
  player1?: Player;
  player2?: Player;
  socketId?: SocketId;
  ready?: boolean;
}

export interface Lobby {
  code: LobbyCode;
  // Empty string here is equivalent to "no password". We could use undefined
  // but we can consider them the same.
  password: string;
  machines: Record<SocketId, Machine>;
  spectators: Record<SocketId, Spectator>;

  songInfo?: SongInfo;
}

export interface LobbyInfo {
  code: LobbyCode;
  isPasswordProtected: boolean;
  playerCount: number;
  spectatorCount: number;
}

export class LOBBYMAN {
  // Mapping from lobby code to a Lobby
  static lobbies: Record<string, Lobby>;

  // Mapping from socketId to the lobby code of the lobby it's connected to.
  static machineConnections: Record<SocketId, LobbyCode>;

  // Mapping from socketId to the lobby code for the spectators.
  static spectatorConnections: Record<SocketId, LobbyCode>;
}

export class ROOMMAN {
  // Mapping of lobby ids (rooms) to the socketIds in that room
  private static rooms: Record<LobbyCode, Array<SocketId>> = {};

  static join(socketId: SocketId, code: LobbyCode) {
    if (!this.rooms[code]) {
      this.rooms[code] = [];
    }
    const sockets = this.rooms[code];
    if (sockets.includes(socketId)) {
      console.warn(`Socket ${socketId} is already in room ${code}`);
      return;
    }
    console.info(`Socket ${socketId} is joining room ${code}`);
    sockets.push(socketId);
  }

  static leave(socketId: SocketId, code: LobbyCode) {
    if (!this.rooms[code]) {
      console.warn(`No room for code ${code}`);
      return;
    }
    const sockets = this.rooms[code];
    if (!sockets) {
      throw new Error('No socket with code ' + code); // Shouldn't happen, since we set the code right before this
    }
    if (!sockets.includes(socketId)) {
      console.warn(`Socket ${socketId} is not in room ${code}`);
      return;
    }
    console.info(`Socket ${socketId} is leaving room ${code}`);
    this.rooms[code] = sockets.filter((s) => s !== socketId);
  }

  static isJoined(socketId: SocketId, code: LobbyCode): boolean {
    if (!this.rooms[code]) return false;
    return Boolean(this.rooms[code].includes(socketId));
  }
}
