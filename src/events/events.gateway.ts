import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import {
  LOBBYMAN,
  LobbyCode,
  LobbyInfo,
  Player,
  ROOMMAN,
  SocketId,
} from '../types/models.types';
import {
  disconnectSpectator,
  canJoinLobby,
  generateLobbyCode,
  getPlayerCountForLobby,
  RETAINED_PLAYER_KEYS,
  inSongSelect,
  responseStatusFailure,
} from './utils';
import {
  CreateLobbyData,
  JoinLobbyPayload,
  LobbyLeftPayload,
  LobbySearchedPayload,
  LobbySpectatedPayload,
  ResponseStatusPayload,
  EventMessage,
  EventType,
  SpectateLobbyPayload,
  UpdateMachinePayload,
  SelectSongPayload,
  LobbyStatePayload,
} from './events.types';
import { merge, pick } from 'lodash';

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
          console.log('Sending response', JSON.stringify(response, null, 2));
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
      this.disconnectMachine(socketId);
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
      this.disconnectMachine(socketId);
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

    this.broadcastLobbyState(code);
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
      this.disconnectMachine(socketId);
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
    ROOMMAN.join(socketId, code);
    LOBBYMAN.machineConnections[socketId] = code;
    console.log('Machine ' + `${socketId}` + 'joined ' + `${code}`);

    this.broadcastLobbyState(code);

    return undefined;
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

    // Merge the incoming machine data with the respective lobby's machine
    const playersInSongSelectBefore = inSongSelect(lobby);
    merge(lobby.machines[socketId], machine);
    const playersInSongSelectAfter = inSongSelect(lobby);

    // If all players have transitioned back to song select,
    // Ensure the scores and currently-selected song get reset
    if (!playersInSongSelectBefore && playersInSongSelectAfter) {
      lobby.songInfo = undefined;
      Object.values(lobby.machines).forEach((machine) => {
        // Only retain relevant fields
        if (machine.player1) {
          machine.player1 = pick(machine.player1, RETAINED_PLAYER_KEYS);
        }
        if (machine.player2) {
          machine.player2 = pick(machine.player2, RETAINED_PLAYER_KEYS);
        }
      });
    }

    this.broadcastLobbyState(lobby.code);
    return undefined;
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
    this.broadcastLobbyState(code);

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

    this.broadcastLobbyState(code);

    return undefined;
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
    left = this.disconnectMachine(socketId);
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

  private broadcastLobbyState(code: LobbyCode) {
    const lobby = this.getLobbyState(code);
    if (lobby) {
      this.clients.sendLobby(lobby, code);
    }
  }

  private getLobbyState(
    code: LobbyCode,
  ): EventMessage<LobbyStatePayload> | null {
    // Send back the machine state with the socket ids omitted
    const players: Player[] = [];
    const lobby = LOBBYMAN.lobbies[code];
    Object.values(lobby.machines).forEach((machine) => {
      const { player1, player2 } = machine;
      if (player1) {
        players.push(player1);
      }
      if (player2) {
        players.push(player2);
      }
    });
    const { songInfo } = lobby;

    return { event: 'lobbyState', data: { players, songInfo, code } };
  }

  /**
   * Makes a machine leave a lobby. If the machine was the last player in the
   * lobby, the lobby will be deleted and all spectators will be disconnected.
   * @param socketId, The socket ID of the machine to disconnect.
   * @returns True if the machine left the lobby, false otherwise.
   */
  private disconnectMachine(socketId: SocketId): boolean {
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
          this.clients.disconnect(spectator.socketId);
          delete LOBBYMAN.spectatorConnections[spectator.socketId];
        }
      }
      delete LOBBYMAN.lobbies[code];
    } else {
      // When a client disconnects, notify other clients
      const stateMessage = this.getLobbyState(code);
      if (stateMessage) {
        this.clients.sendLobby(stateMessage, code);
      }
    }
    return true;
  }
}
