import { SocketId } from 'socket.io-adapter';
import {
  CLIENTS,
  LOBBYMAN,
  Lobby,
  Machine,
  ROOMMAN,
} from '../types/models.types';
import { Message } from './events.types';

/**
 * Determines if the correct credentials are provided to join a lobby.
 * @param code, The lobby code to join.
 * @param password, The password to join the lobby with.
 * @returns True if the lobby exists and the password is correct, false
 *          otherwise.
 */
export function canJoinLobby(code: string, password: string) {
  // Does the lobby we're trying to join exist?
  const lobby = LOBBYMAN.lobbies[code];
  if (lobby === undefined) {
    return false;
  }

  // Join either if the lobby is public, or one has provided a valid
  // password for a private lobby.
  if (!lobby.password || lobby.password === password) {
    return true;
  }
  return false;
}

/**
 * Generates a random lobby code.
 * @returns A random lobby code of 4 uppercase characters.
 */
export function generateLobbyCode(): string {
  const lobbyCodeLength = 4;
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < lobbyCodeLength; ++i) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

/**
 * Gets the number of players in a lobby.
 * @param lobby, The lobby to get the player count for.
 * @returns The number of players in the lobby.
 */
export function getPlayerCountForLobby(lobby: Lobby): number {
  let playerCount = 0;
  for (const machine of Object.values(lobby.machines)) {
    if (machine.player1 !== undefined) {
      playerCount += 1;
    }
    if (machine.player2 !== undefined) {
      playerCount += 1;
    }
  }
  return playerCount;
}

/**
 * Makes a machine leave a lobby. If the machine was the last player in the
 * lobby, the lobby will be deleted and all spectators will be disconnected.
 * @param socketId, The socket ID of the machine to disconnect.
 * @returns True if the machine left the lobby, false otherwise.
 */
export function disconnectMachine(socketId: SocketId): boolean {
  const code = LOBBYMAN.machineConnections[socketId];
  if (code === undefined) {
    return false;
  }

  const lobby = LOBBYMAN.lobbies[code];
  if (lobby === undefined) {
    return false;
  }

  const machine = lobby.machines[socketId];
  if (machine === undefined) {
    return false;
  }

  if (machine.socketId) {
    if (machine.socketId in LOBBYMAN.machineConnections) {
      delete LOBBYMAN.machineConnections[machine.socketId];
    }

    ROOMMAN.leave(machine.socketId, code);
    // Don't disconnect here, as we may be re-using the connection.
    // In the case of `leaveLobby`, the client can manually disconnect.
  }
  delete lobby.machines[socketId];
  delete LOBBYMAN.machineConnections[socketId];

  if (getPlayerCountForLobby(lobby) === 0) {
    for (const spectator of Object.values(lobby.spectators)) {
      if (spectator.socketId) {
        ROOMMAN.leave(spectator.socketId, code);
        // Force a disconnect. If there are no more players in the lobby,
        // we should remove the spectators as well.
        CLIENTS.disconnect(spectator.socketId);
        delete LOBBYMAN.spectatorConnections[spectator.socketId];
      }
    }
    delete LOBBYMAN.lobbies[code];
  }
  return true;
}

/**
 * Makes a spectator leave a lobby.
 * @param socketId, The socket ID of the spectator to disconnect.
 * @returns, True if the spectator left the lobby, false otherwise.
 */
export function disconnectSpectator(socketId: SocketId): boolean {
  const code = LOBBYMAN.spectatorConnections[socketId];
  if (code === undefined) {
    return false;
  }

  const lobby = LOBBYMAN.lobbies[code];
  if (lobby === undefined) {
    return false;
  }

  const spectator = lobby.spectators[socketId];
  if (spectator === undefined) {
    return false;
  }

  if (spectator.socketId) {
    ROOMMAN.leave(spectator.socketId, code);
    // Don't disconnect here, as we may be re-using the connection.
  }
  delete lobby.spectators[socketId];
  delete LOBBYMAN.spectatorConnections[socketId];
  return true;
}

/** Gets the lobby for specific connection.
 * @returns, lobby if the machine is part of one, or undefined otherwise.
 */
export function getLobbyForMachine(socketId: SocketId): Lobby | undefined {
  const code = LOBBYMAN.machineConnections[socketId];
  if (code === undefined) {
    return undefined;
  }

  return LOBBYMAN.lobbies[code];
}

export function getLobbyState(socketId: SocketId): Message | null {
  const lobby = getLobbyForMachine(socketId);
  if (lobby === undefined) {
    return null;
  }

  // Send back the machine state with the socket ids omitted
  const machines = Object.entries(lobby.machines).map((m) => ({
    socketId,
    ...m,
  }));

  return { type: 'lobbyState', payload: { machines } };
}
