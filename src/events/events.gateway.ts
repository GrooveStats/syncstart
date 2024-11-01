import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import {
  CLIENTS,
  LOBBYMAN,
  LobbyInfo,
  ROOMMAN,
  SocketId,
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
  JoinLobbyPayload,
  LobbyCreatedPayload,
  LobbyJoinedPayload,
  LobbyLeftPayload,
  LobbySearchedPayload,
  LobbySpectatedPayload,
  Message,
  MessageType,
  ReadyUpResultPayload,
  SearchLobbyPayload,
  SpectateLobbyPayload,
} from './events.types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** Maps received message types to a callback function to handle those message.
   * The callback function may return a message to send to the calling socket */
  private handlers: Map<
    MessageType,
    (socketId: SocketId, payload: any) => Promise<Message | undefined>
  > = new Map();

  afterInit() {
    this.handlers.set('createLobby', this.createLobby);
    this.handlers.set('joinLobby', this.joinLobby);
    this.handlers.set('leaveLobby', this.leaveLobby);
    this.handlers.set('spectateLobby', this.spectateLobby);
    this.handlers.set('searchLobby', this.searchLobby);
    this.handlers.set('readyUp', this.readyUp);
  }

  /**
   * Listener to handle new websocket connections. Responsible for notifying our CLIENTS manager
   * and setting up callbacks to handle incoming messages */
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
      if (response) {
        CLIENTS.sendSocket(response, socketId);
      }
    });
  }

  /**
   * Cleans up the lobby manager when a client disconnects.
   * @param socket, The socket id that disconnected.
   * @override OnGatewayDisconnect
   */
  handleDisconnect(socket: WebSocket) {
    let socketId: SocketId;
    try {
      socketId = CLIENTS.getSocketId(socket);
    } catch (e) {
      console.error('Disconnect not handled, socketId not found for socket');
      return;
    }
    console.info('Disconnecting socket ' + socketId);

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
  ): Promise<Message<LobbyCreatedPayload>> {
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
  async joinLobby(
    socketId: SocketId,
    { machine, code, password }: JoinLobbyPayload,
  ): Promise<Message<LobbyJoinedPayload>> {
    if (!canJoinLobby(code, password)) {
      return { type: 'lobbyJoined', payload: { joined: false } };
    }

    if (socketId in LOBBYMAN.spectatorConnections) {
      disconnectSpectator(socketId);
    }

    if (socketId in LOBBYMAN.machineConnections) {
      // A machine can only join one lobby at a time.
      disconnectMachine(socketId);
    }

    const lobby = LOBBYMAN.lobbies[code];
    lobby.machines[socketId] = {
      ...machine,
      socketId,
      ready: false,
    };
    LOBBYMAN.machineConnections[socketId] = code;
    console.log('Machine ' + `${socketId}` + 'joined ' + `${code}`);

    return { type: 'lobbyJoined', payload: { joined: true } };
  }

  /**
   * Removes a machine from a lobby.
   * @param client, The socket connection of the machine to disconnect.
   * @returns, True if the machine was disconnected successfully.
   */
  async leaveLobby(socketId: SocketId): Promise<Message<LobbyLeftPayload>> {
    const left = disconnectMachine(socketId);
    return { type: 'lobbyLeft', payload: { left } };
  }

  /**
   * Connects a spectator to an existing lobby.
   * @param socketId, The socket that connected.
   * @param spectator, The spectator to connect to a lobby.
   * @param code, The code for the lobby to spectate.
   * @param password, The password for the lobby.
   * @returns, The number of spectators in the lobby.
   */
  async spectateLobby(
    socketId: SocketId,
    { spectator, code, password }: SpectateLobbyPayload,
  ): Promise<Message<LobbySpectatedPayload>> {
    const lobby = LOBBYMAN.lobbies[code];

    if (!lobby) {
      return { type: 'lobbySpectated', payload: { spectators: 0 } };
    }

    if (
      !(socketId in LOBBYMAN.machineConnections) &&
      canJoinLobby(code, password)
    ) {
      if (socketId in LOBBYMAN.spectatorConnections) {
        // A spectator can only spectate one lobby at a time.
        disconnectSpectator(socketId);
      }

      lobby.spectators[socketId] = {
        ...spectator,
        socketId,
      };
      ROOMMAN.join(socketId, code);
      LOBBYMAN.spectatorConnections[socketId] = code;
    }
    return {
      type: 'lobbySpectated',
      payload: { spectators: Object.keys(lobby.spectators).length },
    };
  }

  /**
   * Searches for all active lobbies.
   * @returns, The list of lobbies that are currently active.
   */
  async searchLobby(): Promise<Message<LobbySearchedPayload>> {
    const lobbies: LobbyInfo[] = Object.values(LOBBYMAN.lobbies).map((l) => ({
      code: l.code,
      isPasswordProtected: l.password.length !== 0,
      playerCount: getPlayerCountForLobby(l),
      spectatorCount: Object.keys(l.spectators).length,
    }));
    console.log('Found ' + lobbies.length + ' lobbies');
    return { type: 'lobbySearched', payload: { lobbies } };
  }

  /** Updates the ready state of the machine.
   * @param client, The socket that connected.
   * @returns, true if we successfully readied up, false otherwise.
   */
  async readyUp(socketId: SocketId): Promise<Message<ReadyUpResultPayload>> {
    const response: Message = {
      type: 'readyUpResult',
      payload: { ready: false },
    };
    const lobby = getLobbyForMachine(socketId);
    if (lobby === undefined) {
      return { ...response, payload: { ready: false } };
    }

    const machine = lobby.machines[socketId];
    if (machine === undefined) {
      return { ...response, payload: { ready: false } };
    }

    machine.ready = true;
    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      CLIENTS.sendLobby(stateMessage, lobby.code);
    }

    let allReady = true;
    for (const machine of Object.values(lobby.machines)) {
      if (!machine.ready) {
        allReady = false;
        break;
      }
    }

    if (allReady) {
      CLIENTS.sendLobby(
        { type: 'startSong', payload: { start: true } },
        lobby.code,
      );
    }
    return { type: 'readyUpResult', payload: { ready: allReady } };
  }
}
