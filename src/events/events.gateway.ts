import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LOBBYMAN, LobbyInfo, Machine, Spectator } from '../types/models.types';
import {
  disconnectMachine,
  disconnectSpectator,
  canJoinLobby,
  generateLobbyCode,
  getPlayerCountForLobby,
  getLobbyForMachine,
} from './utils';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  /**
   * Cleans up the lobby manager when a client disconnects.
   * @param client, The socket that disconnected.
   */
  handleDisconnect(client: Socket) {
    if (client.id in LOBBYMAN.machineConnections) {
      disconnectMachine(client.id);
    }

    if (client.id in LOBBYMAN.spectatorConnections) {
      disconnectSpectator(client.id);
    }
  }

  /**
   * Creates a new lobby and connects a machine to it.
   * @param client, The socket that connected.
   * @param machine, The machine that connected.
   * @param password, The password for the lobby (empty implies public lobby).
   * @returns, The code for the newly created lobby.
   */
  @SubscribeMessage('createLobby')
  async createLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody('machine') machine: Machine,
    @MessageBody('password') password: string,
  ): Promise<string> {
    if (client.id in LOBBYMAN.spectatorConnections) {
      disconnectSpectator(client.id);
    }

    if (client.id in LOBBYMAN.machineConnections) {
      // A machine can only join one lobby at a time.
      disconnectMachine(client.id);
    }

    let code = generateLobbyCode();
    while (code in LOBBYMAN.lobbies) {
      code = generateLobbyCode();
    }

    LOBBYMAN.lobbies[code] = {
      code: code,
      password: password ? password : '',
      machines: {
        [client.id]: {
          ...machine,
          socket: client,
          ready: false,
        },
      },
      spectators: {},
    };
    client.join(code);
    LOBBYMAN.machineConnections[client.id] = code;
    console.log('Created lobby ' + code);

    return code;
  }

  /**
   * Connects a machine to an existing lobby.
   * @param client, The socket that connected.
   * @param machine, The machine that connected.
   * @param code, The code for the lobby to join.
   * @param password, The password for the lobby.
   * @returns True if the machine joined the lobby, false otherwise.
   */
  @SubscribeMessage('joinLobby')
  async joinLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody('machine') machine: Machine,
    @MessageBody('code') code: string,
    @MessageBody('password') password: string,
  ): Promise<boolean> {
    if (canJoinLobby(code, password)) {
      if (client.id in LOBBYMAN.spectatorConnections) {
        disconnectSpectator(client.id);
      }

      if (client.id in LOBBYMAN.machineConnections) {
        // A machine can only join one lobby at a time.
        disconnectMachine(client.id);
      }

      const lobby = LOBBYMAN.lobbies[code];
      lobby.machines[client.id] = {
        ...machine,
        socket: client,
        ready: false,
      };
      LOBBYMAN.machineConnections[client.id] = code;
      console.log('Machine ' + `${client.id}` + 'joined ' + `${code}`);
      return true;
    }
    return false;
  }

  /**
   * Removes a machine from a lobby.
   * @param client, The socket connection of the machine to disconnect.
   * @returns, True if the machine was disconnected successfully.
   */
  @SubscribeMessage('leaveLobby')
  async leaveLobby(@ConnectedSocket() client: Socket): Promise<boolean> {
    return disconnectMachine(client.id);
  }

  /**
   * Connects a spectator to an existing lobby.
   * @param client, The socket that connected.
   * @param spectator, The spectator to connect to a lobby.
   * @param code, The code for the lobby to spectate.
   * @param password, The password for the lobby.
   * @returns, The number of spectators in the lobby.
   */
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
        canJoinLobby(code, password)
      ) {
        if (client.id in LOBBYMAN.spectatorConnections) {
          // A spectator can only spectate one lobby at a time.
          disconnectSpectator(client.id);
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

  /**
   * Searches for all active lobbies.
   * @returns, The list of lobbies that are currently active.
   */
  @SubscribeMessage('searchLobby')
  async searchLobby(): Promise<LobbyInfo[]> {
    const lobbyInfo: LobbyInfo[] = [];
    for (const lobby of Object.values(LOBBYMAN.lobbies)) {
      lobbyInfo.push({
        code: lobby.code,
        isPasswordProtected: lobby.password.length !== 0,
        playerCount: getPlayerCountForLobby(lobby),
        spectatorCount: Object.keys(lobby.spectators).length,
      });
    }
    console.log('Found ' + lobbyInfo.length + ' lobbies');
    return lobbyInfo;
  }

  /** Updates the ready state of the machine.
   * @returns, true if we successfully readied up, false otherwise.
  */
  @SubscribeMessage('readyUp')
  async readyUp(
    @ConnectedSocket() client: Socket,
  ): Promise<boolean> {
    const lobby = getLobbyForMachine(client.id);
    if (lobby === undefined) { return false; }

    const machine = lobby.machines[client.id];
    if (machine === undefined) { return false; }
    
    machine.ready = true;
    return true;
  }
  
  /** Starts the song of the same lobby as the machine
   */
  async startSong(@ConnectedSocket() client: Socket): Promise<boolean> {
    const lobby = getLobbyForMachine(client.id);
    if (lobby === undefined) { return false; }

    let allReady = true;
    for (const machine of Object.values(lobby.machines)) {
      if (!machine.ready) {
        allReady = false;
        break;
      }
    }

    if (allReady) {
      for (const machine of Object.values(lobby.machines)) {
        if (machine.socket !== undefined) {
          machine.socket.emit('start');
        }
      }

    }
    return false;
  }


}
