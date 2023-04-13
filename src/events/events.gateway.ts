import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketId } from 'socket.io-adapter';
import {
  LOBBYMAN,
  Lobby,
  LobbyInfo,
  Machine,
  Spectator,
} from '../types/models.types';

function CanJoinLobby(code: string, password: string) {
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

function GenerateLobbyCode(): string {
  const lobbyCodeLength = 4;
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < lobbyCodeLength; ++i) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

function GetPlayerCountForLobby(lobby: Lobby): number {
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

function DisconnectMachine(socketId: SocketId): boolean {
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
          // Don't disconnect here, as we have a callback.
        }
        delete lobby.machines[socketId];
        delete LOBBYMAN.machineConnections[socketId];

        if (GetPlayerCountForLobby(lobby) === 0) {
          for (const spectator of Object.values(lobby.spectators)) {
            if (spectator.socket) {
              spectator.socket.leave(code);
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

// Disconnect and remove a spectator from a lobby.
function DisconnectSpectator(socketId: SocketId): boolean {
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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('createLobby')
  async createLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody('machine') machine: Machine,
    @MessageBody('password') password: string,
  ): Promise<string> {
    if (client.id in LOBBYMAN.spectatorConnections) {
      DisconnectSpectator(client.id);
    }

    if (client.id in LOBBYMAN.machineConnections) {
      // A machine can only join one lobby at a time.
      DisconnectMachine(client.id);
    }

    let code = GenerateLobbyCode();
    while (code in LOBBYMAN.lobbies) {
      code = GenerateLobbyCode();
    }

    LOBBYMAN.lobbies[code] = {
      code: code,
      password: password ? password : '',
      machines: {
        [client.id]: {
          ...machine,
          socket: client,
        },
      },
      spectators: {},
    };
    client.join(code);
    LOBBYMAN.machineConnections[client.id] = code;
    console.log('Created lobby ' + code);

    return code;
  }

  @SubscribeMessage('joinLobby')
  async joinLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody('machine') machine: Machine,
    @MessageBody('code') code: string,
    @MessageBody('password') password: string,
  ): Promise<void> {
    if (CanJoinLobby(code, password)) {
      if (client.id in LOBBYMAN.spectatorConnections) {
        DisconnectSpectator(client.id);
      }

      if (client.id in LOBBYMAN.machineConnections) {
        // A machine can only join one lobby at a time.
        DisconnectMachine(client.id);
      }

      const lobby = LOBBYMAN.lobbies[code];
      lobby.machines[client.id] = {
        ...machine,
        socket: client,
      };
      LOBBYMAN.machineConnections[client.id] = code;
      console.log('Machine ' + `${client.id}` + 'joined ' + `${code}`);
    }
  }

  @SubscribeMessage('leaveLobby')
  async leaveLobby(@ConnectedSocket() client: Socket): Promise<boolean> {
    return DisconnectMachine(client.id);
  }

  @SubscribeMessage('spectateLobby')
  async spectateLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody('spectator') spectator: Spectator,
    @MessageBody('code') code: string,
    @MessageBody('password') password: string,
  ): Promise<number> {
    const lobby = LOBBYMAN.lobbies[code];
    if (lobby) {
      if (
        !(client.id in LOBBYMAN.machineConnections) &&
        CanJoinLobby(code, password)
      ) {
        if (client.id in LOBBYMAN.spectatorConnections) {
          // A spectator can only spectate one lobby at a time.
          DisconnectSpectator(client.id);
        }

        lobby.spectators[client.id] = {
          ...spectator,
          socket: client,
        };
        client.join(code);
        LOBBYMAN.spectatorConnections[client.id] = code;
      }
      return Object.keys(lobby.spectators).length;
    }
    return 0;
  }

  @SubscribeMessage('searchLobby')
  async searchLobby(): Promise<LobbyInfo[]> {
    const lobbyInfo: LobbyInfo[] = [];
    for (const lobby of Object.values(LOBBYMAN.lobbies)) {
      lobbyInfo.push({
        code: lobby.code,
        isPasswordProtected: lobby.password.length !== 0,
        playerCount: GetPlayerCountForLobby(lobby),
        spectatorCount: Object.keys(lobby.spectators).length,
      });
    }
    console.log('Found ' + lobbyInfo.length + ' lobbies');
    return lobbyInfo;
  }
}
