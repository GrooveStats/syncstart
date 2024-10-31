import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WebSocket } from 'ws';
import {
  CLIENTS,
  LOBBYMAN,
  LobbyInfo,
  Machine,
  ROOMMAN,
  SocketId,
  Spectator,
} from '../types/models.types';
import {
  disconnectMachine,
  disconnectSpectator,
  canJoinLobby,
  generateLobbyCode,
  getPlayerCountForLobby,
  getLobbyForMachine,
  getLobbyState,
} from './utils';
import {
  CreateLobbyPayload,
  LobbyCreatedPayload,
  Message,
  MessageType,
} from './events.types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private handlers: Map<
    MessageType,
    (socketId: SocketId, payload: any) => Promise<Message>
  > = new Map();

  afterInit(server: Server) {
    this.handlers.set('createLobby', this.createLobby);
  }

  handleConnection(socket: WebSocket, ...args: any[]) {
    const socketId = CLIENTS.connect(socket);

    socket.on('message', async (messageBuffer: Buffer) => {
      const message: Message = JSON.parse(messageBuffer.toString());
      if (!message.type || !message.payload) {
        throw new Error('Message requires a type and a payload');
      }
      if (!this.handlers.has(message.type)) {
        throw new Error(`No handler for message type "${message.type}"`);
      }
      const handler = this.handlers.get(message.type);
      if (!handler) {
        throw new Error('Missing handler'); // Should not happen, but makes TS happy
      }
      const response = await handler(socketId, message.payload);

      CLIENTS.send(response);
    });
    socket.on('close', () => this.handleDisconnect(socketId));
  }

  /**
   * Cleans up the lobby manager when a client disconnects.
   * @param socketId, The socket id that disconnected.
   */
  handleDisconnect(socketId: string) {
    CLIENTS.disconnect(socketId);

    if (socketId in LOBBYMAN.machineConnections) {
      disconnectMachine(socketId);
    }

    if (socketId in LOBBYMAN.spectatorConnections) {
      disconnectSpectator(socketId);
    }
  }

  /**
   * Creates a new lobby and connects a machine to it.
   * @param socketId, The socket that connected.
   * @param machine, The machine that connected.
   * @param password, The password for the lobby (empty implies public lobby).
   * @returns, The code for the newly created lobby.
   */
  async createLobby(
    socketId: string,
    { machine, password }: CreateLobbyPayload,
  ): Promise<Message> {
    if (socketId in LOBBYMAN.spectatorConnections) {
      disconnectSpectator(socketId);
    }

    if (socketId in LOBBYMAN.machineConnections) {
      // A machine can only join one lobby at a time.
      disconnectMachine(socketId);
    }

    let code = generateLobbyCode();
    while (code in LOBBYMAN.lobbies) {
      code = generateLobbyCode();
    }

    LOBBYMAN.lobbies[code] = {
      code,
      password: password || '',
      machines: {
        [socketId]: {
          ...machine,
          socketId,
          ready: false,
        },
      },
      spectators: {},
    };
    ROOMMAN.join(socketId, code);
    LOBBYMAN.machineConnections[socketId] = code;
    console.log('Created lobby ' + code);

    return { type: 'lobbyCreated', payload: { code } as LobbyCreatedPayload };
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
        socketId: client.id,
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
          socketId: client.id,
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
   * @param client, The socket that connected.
   * @returns, true if we successfully readied up, false otherwise.
   */
  @SubscribeMessage('readyUp')
  async readyUp(@ConnectedSocket() client: Socket): Promise<boolean> {
    const lobby = getLobbyForMachine(client.id);
    if (lobby === undefined) {
      return false;
    }

    const machine = lobby.machines[client.id];
    if (machine === undefined) {
      return false;
    }

    machine.ready = true;
    client.nsp.to(lobby.code).emit('state', getLobbyState(client.id));

    let allReady = true;
    for (const machine of Object.values(lobby.machines)) {
      if (!machine.ready) {
        allReady = false;
        break;
      }
    }

    if (allReady) {
      client.nsp.to(lobby.code).emit('startSong');
    }
    return true;
  }
}
