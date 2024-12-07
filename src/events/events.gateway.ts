import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import {
  LOBBYMAN,
  LobbyInfo,
  PlayerId,
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
  MachineUpdatedPayload,
  Message,
  MessageType,
  ReadyUpPayload,
  ReadyUpResultPayload,
  SpectateLobbyPayload,
  UpdateMachinePayload,
} from './events.types';
import { ClientService } from '../clients/client.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** Maps received message types to a callback function to handle those message.
   * The callback function may return a message to send to the calling socket */
  private handlers: Partial<
    Record<
      MessageType,
      (socketId: SocketId, payload: any) => Promise<Message | undefined>
    >
  >;

  constructor(private readonly clients: ClientService) {}

  afterInit() {
    this.handlers = {
      createLobby: this.createLobby,
      joinLobby: this.joinLobby,
      leaveLobby: this.leaveLobby,
      spectateLobby: this.spectateLobby,
      searchLobby: this.searchLobby,
      readyUp: this.readyUp,
      updateMachine: this.updateMachine,
    };
  }

  /**
   * Listener to handle new websocket connections. Responsible for notifying our CLIENTS manager
   * and setting up callbacks to handle incoming messages */
  handleConnection(socket: WebSocket) {
    const socketId = this.clients.connect(socket);

    socket.on('message', async (messageBuffer: Buffer) => {
      try {
        const message: Message = JSON.parse(messageBuffer.toString());
        if (!message.type || !message.payload) {
          throw new Error('Message requires a type and a payload');
        }
        if (!this.handlers[message.type]) {
          throw new Error(`No handler for message type "${message.type}"`);
        }
        const handler = this.handlers[message.type];
        if (!handler) {
          throw new Error('Missing handler'); // Should not happen, but makes TS happy
        }
        // Retain "this" context within the handler callbacks (otherwise we lose this.clients)
        const handlerBinded = handler.bind(this);
        const response = await handlerBinded(socketId, message.payload);
        if (response) {
          this.clients.sendSocket(response, socketId);
        }
      } catch (e) {
        console.error('Error handling message', e);
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
      socketId = this.clients.getSocketId(socket);
    } catch (e) {
      console.error('Disconnect not handled, socketId not found for socket');
      return;
    }
    console.info('Disconnecting socket ' + socketId);

    this.clients.disconnect(socketId);

    if (socketId in LOBBYMAN.machineConnections) {
      disconnectMachine(socketId, this.clients);
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
      disconnectMachine(socketId, this.clients);
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
          // ready: false,
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
      disconnectMachine(socketId, this.clients);
    }

    const lobby = LOBBYMAN.lobbies[code];
    if (Object.keys(lobby.machines).length >= 4) {
      return {
        type: 'lobbyJoined',
        payload: { joined: false, message: 'Too many machines in lobby' },
      };
    }

    lobby.machines[socketId] = {
      ...machine,
      socketId,
      // ready: false,
    };
    LOBBYMAN.machineConnections[socketId] = code;
    console.log('Machine ' + `${socketId}` + 'joined ' + `${code}`);

    return { type: 'lobbyJoined', payload: { joined: true } };
  }

  /**
   * Updates a machine
   */
  async updateMachine(
    socketId: SocketId,
    { machine }: UpdateMachinePayload,
  ): Promise<Message<MachineUpdatedPayload>> {
    const code = LOBBYMAN.machineConnections[socketId];
    if (!code) {
      return {
        type: 'machineUpdated',
        payload: { updated: false, message: 'Code not found' },
      };
    }
    const lobby = LOBBYMAN.lobbies[code];
    lobby.machines[socketId] = machine;

    return { type: 'machineUpdated', payload: { updated: true } };
  }

  /**
   * Removes a machine from a lobby.
   * @param client, The socket connection of the machine to disconnect.
   * @returns, True if the machine was disconnected successfully.
   */
  async leaveLobby(socketId: SocketId, {}): Promise<Message<LobbyLeftPayload>> {
    let left = false;
    left = disconnectMachine(socketId, this.clients);
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
  async readyUp(
    socketId: SocketId,
    { playerId }: ReadyUpPayload,
  ): Promise<Message<ReadyUpResultPayload>> {
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

    if (machine.player1?.playerId === playerId) {
      machine.player1.ready = true;
    }
    if (machine.player2?.playerId === playerId) {
      machine.player2.ready = true;
    }

    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      this.clients.sendLobby(stateMessage, lobby.code);
    }

    let allReady = true;
    for (const machine of Object.values(lobby.machines)) {
      const { player1, player2 } = machine;
      if (player1 && !player1.ready) {
        allReady = false;
        break;
      }
      if (player2 && !player2.ready) {
        allReady = false;
        break;
      }
    }

    if (allReady) {
      this.clients.sendLobby(
        { type: 'startSong', payload: { start: true } },
        lobby.code,
      );
    }
    return { type: 'readyUpResult', payload: { ready: allReady } };
  }
}
