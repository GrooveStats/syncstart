import { SocketId } from 'socket.io-adapter';
import { LOBBYMAN, Lobby } from '../types/models.types';

/**
 * Determines if the correct credentials are provided to join a lobby.
 * @param code, The lobby code to join.
 * @param password, The password to join the lobby with.
 * @returns True if the lobby exists and the password is correct, false
 *          otherwise.
 */
export function CanJoinLobby(code: string, password: string) {
  // Does the lobby we're trying to join exist?
  if (code in LOBBYMAN.lobbies) {
    const lobby = LOBBYMAN.lobbies[code];
    // Join either if the lobby is public, or one has provided a valid
    // password for a private lobby.
    if (!lobby.password || lobby.password === password) {
      return true;
    }
  }
  return false;
}

/**
 * Generates a random lobby code.
 * @returns A random lobby code of 4 uppercase characters.
 */
export function GenerateLobbyCode(): string {
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
export function GetPlayerCountForLobby(lobby: Lobby): number {
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
export function DisconnectMachine(socketId: SocketId): boolean {
  const code = LOBBYMAN.machineConnections[socketId];
  if (code) {
    const lobby = LOBBYMAN.lobbies[code];
    if (lobby) {
      const machine = lobby.machines[socketId];
      if (machine) {
        if (machine.socket) {
          if (machine.socket.id in LOBBYMAN.machineConnections) {
            delete LOBBYMAN.machineConnections[machine.socket.id];
          }

          machine.socket.leave(code);
          // Don't disconnect here, as we may be re-using the connection.
          // In the case of `leaveLobby`, the client can manually disconnect.
        }
        delete lobby.machines[socketId];
        delete LOBBYMAN.machineConnections[socketId];

        if (GetPlayerCountForLobby(lobby) === 0) {
          for (const spectator of Object.values(lobby.spectators)) {
            if (spectator.socket) {
              spectator.socket.leave(code);
              // Force a disconnect. If there are no more players in the lobby,
              // we should remove the spectators as well.
              spectator.socket.disconnect();
              delete LOBBYMAN.spectatorConnections[spectator.socket.id];
            }
          }
          delete LOBBYMAN.lobbies[code];
        }
        return true;
      }
    }
  }
  return false;
}

/**
 * Makes a spectator leave a lobby.
 * @param socketId, The socket ID of the spectator to disconnect.
 * @returns, True if the spectator left the lobby, false otherwise.
 */
export function DisconnectSpectator(socketId: SocketId): boolean {
  const code = LOBBYMAN.spectatorConnections[socketId];
  if (code) {
    const lobby = LOBBYMAN.lobbies[code];
    if (lobby) {
      const spectator = lobby.spectators[socketId];
      if (spectator) {
        if (spectator.socket) {
          spectator.socket.leave(code);
          // Don't disconnect here, as we may be re-using the connection.
        }
        delete lobby.spectators[socketId];
        delete LOBBYMAN.spectatorConnections[socketId];
        return true;
      }
    }
  }
  return false;
}
