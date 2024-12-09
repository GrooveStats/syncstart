import {
  LOBBYMAN,
  Lobby,
  Player,
  ROOMMAN,
  SocketId,
} from '../types/models.types';
import { EventMessage, EventType, ResponseStatusPayload } from './events.types';

/** Keys retained when the game state is reset.
 *  @see updateMachine */
export const RETAINED_PLAYER_KEYS: Array<keyof Player> = [
  'playerId',
  'profileName',
  'screenName',
  'ready',
];

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

  console.log('Getting lobby state', code, socketId);

  if (code === undefined) {
    return undefined;
  }

  return LOBBYMAN.lobbies[code];
}

/**
 * Constructs a ResponseStatus event with a success or fail.
 */
export function responseStatus(
  event: EventType,
  success: boolean,
  message?: string,
): EventMessage<ResponseStatusPayload> {
  return {
    event: 'responseStatus',
    data: {
      event,
      success,
      message,
    },
  };
}

/**
 * Constructs a Response status event with a failure.
 * @param event
 * @param message
 * @returns
 */
export function responseStatusFailure(
  event: EventType,
  message: string,
): EventMessage<ResponseStatusPayload> {
  return responseStatus(event, false, message);
}

export function inSongSelect(lobby: Lobby): boolean {
  let selecting = true;
  Object.values(lobby.machines).forEach(({ player1, player2 }) => {
    if (player1 && player1.screenName !== 'ScreenSelectMusic') {
      selecting = false;
      return;
    }
    if (player2 && player2.screenName !== 'ScreenSelectMusic') {
      selecting = false;
      return;
    }
  });
  return selecting;
}
