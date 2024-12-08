import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import {
  LOBBYMAN,
  Lobby,
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
  getLobbyState,
} from './utils';
import {
  CreateLobbyData,
  JoinLobbyPayload,
  LobbyLeftPayload,
  LobbySearchedPayload,
  LobbySpectatedPayload,
  ResponseStatusPayload,
  EventMessage,
  MessageType as EventType,
  SpectateLobbyPayload,
  UpdateMachinePayload,
  SelectSongPayload,
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
      EventType,
      (socketId: SocketId, payload: any) => Promise<EventMessage | undefined>
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
      updateMachine: this.updateMachine,
      lobbyState: this.lobbyState,
      selectSong: this.selectSong,
    };
  }

  /**
   * Listener to handle new websocket connections. Responsible for notifying our CLIENTS manager
   * and setting up callbacks to handle incoming messages */
  handleConnection(socket: WebSocket) {
    const socketId = this.clients.connect(socket);

    socket.on('message', async (messageBuffer: Buffer) => {
      try {
        const messageString = messageBuffer.toString();
        let message: EventMessage;
        try {
          message = JSON.parse(messageString);
        } catch (e) {
          console.error('Error parsing message', messageString);
          return;
        }

        console.log('Received message:', JSON.stringify(message, null, 2));
        if (!message.event) {
          console.log('No event, ignoring');
          return;
        }
        if (!this.handlers[message.event]) {
          throw new Error(`No handler for message type "${message.event}"`);
        }
        const handler = this.handlers[message.event];
        if (!handler) {
          throw new Error('Missing handler'); // Should not happen, but makes TS happy
        }
        // Retain "this" context within the handler callbacks (otherwise we lose this.clients)
        const handlerBinded = handler.bind(this);
        const response = await handlerBinded(socketId, message.data);
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
    { machine, password }: CreateLobbyData,
  ): Promise<undefined> {
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
        },
      },
      spectators: {},
    };
    ROOMMAN.join(socketId, code);
    LOBBYMAN.machineConnections[socketId] = code;
    console.log('Created lobby ' + code);

    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      this.clients.sendLobby(stateMessage, code);
    }
    return undefined;
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
  ): Promise<EventMessage<ResponseStatusPayload> | undefined> {
    if (!canJoinLobby(code, password)) {
      return {
        event: 'responseStatus',
        data: {
          event: 'joinLobby',
          success: false,
          message:
            'Cannot join lobby. Check the code + password and try again.',
        },
      };
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
      responseStatusFailure('joinLobby', 'Too many machines in the lobby');
    }

    if (lobby.songInfo) {
      responseStatusFailure(
        'joinLobby',
        'A song is already selected, please try later.',
      );
    }

    lobby.machines[socketId] = {
      ...machine,
      socketId,
    };
    LOBBYMAN.machineConnections[socketId] = code;
    console.log('Machine ' + `${socketId}` + 'joined ' + `${code}`);

    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      this.clients.sendLobby(stateMessage, lobby.code);
    }
    return undefined;
    // return responseStatusSuccess('joinLobby');
  }

  /**
   * Updates a machine
   */
  async updateMachine(
    socketId: SocketId,
    { machine }: UpdateMachinePayload,
  ): Promise<EventMessage<ResponseStatusPayload> | undefined> {
    const code = LOBBYMAN.machineConnections[socketId];
    if (!code) {
      return responseStatusFailure('updateMachine', 'Machine not found');
    }
    const lobby = LOBBYMAN.lobbies[code];

    const inSongSelectBefore = inSongSelect(lobby);
    lobby.machines[socketId] = machine;
    const inSongSelectAfter = inSongSelect(lobby);

    if (!inSongSelectBefore && inSongSelectAfter) {
      lobby.songInfo = undefined;
      console.log('!!!! CLEARING SONG INFO !!!!');
    }

    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      this.clients.sendLobby(stateMessage, lobby.code);
    }

    return undefined;
    // return responseStatusSuccess('updateMachine');
  }

  /**
   * Updates a machine
   */
  async lobbyState(
    socketId: SocketId,
  ): Promise<EventMessage<ResponseStatusPayload> | undefined> {
    const code = LOBBYMAN.machineConnections[socketId];
    if (!code) {
      return responseStatusFailure('lobbyState', 'Machine not found');
    }
    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      this.clients.sendLobby(stateMessage, code);
    }

    return undefined;
  }

  async selectSong(
    socketId: SocketId,
    { songInfo }: SelectSongPayload,
  ): Promise<EventMessage<ResponseStatusPayload> | undefined> {
    const code = LOBBYMAN.machineConnections[socketId];
    if (!code) {
      return responseStatusFailure('selectSong', 'Machine not found');
    }
    const lobby = LOBBYMAN.lobbies[code];
    if (lobby.songInfo) {
      return responseStatusFailure('selectSong', 'Song already selected');
    }
    lobby.songInfo = songInfo;

    const stateMessage = getLobbyState(socketId);
    if (stateMessage) {
      this.clients.sendLobby(stateMessage, code);
    }

    return undefined;
    // return responseStatusSuccess('selectSong');
  }

  /**
   * Removes a machine from a lobby.
   * @param client, The socket connection of the machine to disconnect.
   * @returns, True if the machine was disconnected successfully.
   */
  async leaveLobby(
    socketId: SocketId,
    {},
  ): Promise<EventMessage<LobbyLeftPayload>> {
    let left = false;
    left = disconnectMachine(socketId, this.clients);
    return { event: 'lobbyLeft', data: { left } };
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
  ): Promise<EventMessage<LobbySpectatedPayload>> {
    const lobby = LOBBYMAN.lobbies[code];

    if (!lobby) {
      return { event: 'lobbySpectated', data: { spectators: 0 } };
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
      event: 'lobbySpectated',
      data: { spectators: Object.keys(lobby.spectators).length },
    };
  }

  /**
   * Searches for all active lobbies.
   * @returns, The list of lobbies that are currently active.
   */
  async searchLobby(): Promise<EventMessage<LobbySearchedPayload>> {
    const lobbies: LobbyInfo[] = Object.values(LOBBYMAN.lobbies).map((l) => ({
      code: l.code,
      isPasswordProtected: l.password.length !== 0,
      playerCount: getPlayerCountForLobby(l),
      spectatorCount: Object.keys(l.spectators).length,
    }));
    console.log('Found ' + lobbies.length + ' lobbies');
    return { event: 'lobbySearched', data: { lobbies } };
  }
}

function responseStatus(
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

function responseStatusFailure(
  event: EventType,
  message: string,
): EventMessage<ResponseStatusPayload> {
  return responseStatus(event, false, message);
}

function inSongSelect(lobby: Lobby): boolean {
  let selecting = true;
  Object.values(lobby.machines).forEach((machine) => {
    if (machine.player1?.screen === 'screenSelectMusic') {
      selecting = false;
      return;
    }
    if (machine.player2?.screen === 'screenSelectMusic') {
      selecting = false;
      return;
    }
  });
  return selecting;
}
