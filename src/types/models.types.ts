import WebSocket = require('ws');
import { v4 as uuidv4 } from 'uuid';
import { Message } from '../events/events.types';

export type SocketId = string;

export type LobbyCode = string;

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

export class Spectator {
  profileName: string;
  socketId?: SocketId;
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
  // able easily play with players that don't, as the songPaths will be
  // different.
  songPath: string;
  title: string;
  artist: string;
  stepartist: string;
  songLength: number;
}

export class Player {
  playerId: string;
  profileName: string;

  judgments?: Judgments;
  score?: number;
  exScore?: number;
}

export class Machine {
  player1?: Player;
  player2?: Player;
  socketId?: SocketId;
  ready?: boolean;
}

export class Lobby {
  code: LobbyCode;
  // Empty string here is equivalent to "no password". We could use undefined
  // but we can consider them the same.
  password: string;
  machines: Record<SocketId, Machine>;
  spectators: Record<SocketId, Spectator>;

  songInfo?: SongInfo;
}

export class LobbyInfo {
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
  private static rooms: Map<LobbyCode, Array<SocketId>> = new Map();

  static join(socketId: SocketId, code: LobbyCode) {
    if (!this.rooms.has(code)) {
      this.rooms.set(code, []);
    }
    const sockets = this.rooms.get(code)!;
    if (sockets.includes(socketId)) {
      console.warn(`Socket ${socketId} is already in room ${code}`);
      return;
    }
    console.info(`Socket ${socketId} is joining room ${code}`);
    sockets.push(socketId);
    console.log(this.rooms);
  }

  static leave(socketId: SocketId, code: LobbyCode) {
    if (!this.rooms.has(code)) {
      console.warn(`No room for code ${code}`);
      return;
    }
    const sockets = this.rooms.get(code)!;
    if (!sockets.includes(socketId)) {
      console.warn(`Socket ${socketId} is not in room ${code}`);
      return;
    }
    console.info(`Socket ${socketId} is leaving room ${code}`);
    this.rooms.set(
      code,
      sockets.filter((s) => s !== socketId),
    );
    console.log(this.rooms);
  }
}

export class CLIENTS {
  private static clients: Map<SocketId, WebSocket> = new Map();

  static send(response: Message) {
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(response));
      }
    });
  }

  static disconnect(socketId: SocketId, reason?: string) {
    if (!this.clients.has(socketId)) {
      console.warn(`Client ${socketId} not connected`);
      return;
    }

    const message: Message = {
      type: 'clientDisconnected',
      payload: { reason: reason || 'Just because' },
    };

    const client = this.clients.get(socketId);
    if (!client) return;

    if (client.readyState === WebSocket.OPEN) {
      this.clients.get(socketId)?.close(1000, JSON.stringify(message));
    }
    this.clients.delete(socketId);
  }

  static connect(socket: WebSocket): string {
    // Assert we're not already connected
    const entry = Object.entries(this.clients).find(
      ([, value]) => socket === value,
    );
    if (entry) {
      console.warn(`Socket ${entry[0]} is already connected`);
      return entry[0];
    }

    // Generate an id for the entry, set and return it
    const socketId = uuidv4();
    this.clients.set(socketId, socket);
    console.log('Socket connected: ', socketId);
    return socketId;
  }
}
