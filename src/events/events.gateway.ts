import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { OnApplicationShutdown } from '@nestjs/common';
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
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  /** Maps received message types to a callback function to handle those message.
   * The callback function may return a message to send to the calling socket */
  private handlers: Partial<
    Record<
      EventType,
      (socketId: SocketId, payload: any) => Promise<EventMessage | undefined>
    >
  >;

  /** Cleanup interval in milliseconds */
  private readonly CLEANUP_INTERVAL = 30000; // 30 seconds
  /** Lobby inactivity timeout in milliseconds */
  private readonly LOBBY_INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  
  private cleanupIntervalId: NodeJS.Timeout | null = null;

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
    
    // Start the cleanup interval to remove stale lobbies
    this.startCleanupInterval();
  }

  /**
   * Updates a lobby's lastUpdate timestamp to track activity.
   * This is used for inactivity-based cleanup of zombie lobbies.
   * @param code The lobby code to update
   */
  private updateLobbyActivity(code: LobbyCode): void {
    const lobby = LOBBYMAN.lobbies[code];
    if (lobby) {
      lobby.lastUpdate = Date.now();
    }
  }

  /**
   * Starts the periodic cleanup interval to remove stale lobbies.
   * Lobbies that haven't been updated for LOBBY_INACTIVITY_TIMEOUT are deleted.
   */
  private startCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupStaleLobbies();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Cleans up lobbies that haven't been updated within LOBBY_INACTIVITY_TIMEOUT.
   * This prevents zombie lobbies from accumulating in memory.
   */
  private cleanupStaleLobbies(): void {
    const now = Date.now();
    const lobbyCodes = Object.keys(LOBBYMAN.lobbies);
    
    for (const code of lobbyCodes) {
      const lobby = LOBBYMAN.lobbies[code];
      if (!lobby) {
        continue;
      }
      
      const timeSinceLastUpdate = now - lobby.lastUpdate;
      if (timeSinceLastUpdate > this.LOBBY_INACTIVITY_TIMEOUT) {
        console.log(
          `Cleaning up stale lobby ${code} (inactive for ${Math.round(
            timeSinceLastUpdate / 1000 / 60,
          )} minutes)`,
        );
        
        // Clean up spectators - forcefully disconnect them
        for (const spectator of Object.values(lobby.spectators)) {
          if (spectator.socketId) {
            ROOMMAN.leave(spectator.socketId, code);
            this.clients.disconnect(spectator.socketId, 'Lobby destroyed due to inactivity');
            delete LOBBYMAN.spectatorConnections[spectator.socketId];
          }
        }
        
        // Clean up machines - forcefully disconnect them
        for (const machine of Object.values(lobby.machines)) {
          if (machine.socketId) {
            ROOMMAN.leave(machine.socketId, code);
            this.clients.disconnect(machine.socketId, 'Lobby destroyed due to inactivity');
            delete LOBBYMAN.machineConnections[machine.socketId];
          }
        }
        
        // Delete the lobby and its room
        delete ROOMMAN.rooms[code];
        delete LOBBYMAN.lobbies[code];
      }
    }
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

        if (!message.event) {
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
      // Socket was already removed from tracking (expected during cleanup-initiated disconnects)
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
   * Cleans up resources when the application shuts down.
   * @override OnApplicationShutdown
   */
  async onApplicationShutdown() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
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
      lastUpdate: Date.now(),
    };
    console.log('Created lobby', { code });

    ROOMMAN.join(socketId, code);
    LOBBYMAN.machineConnections[socketId] = code;
    this.updateLobbyActivity(code);

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
    const normalizedCode = code.toUpperCase();

    if (!canJoinLobby(normalizedCode, password)) {
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

    const lobby = LOBBYMAN.lobbies[normalizedCode];
    if (lobby === undefined) {
      return responseStatusFailure('joinLobby', 'Lobby not found');
    }
    if (Object.keys(lobby.machines).length >= 4) {
      return responseStatusFailure(
        'joinLobby',
        'Too many machines in the lobby',
      );
    }

    if (lobby.songInfo) {
      return responseStatusFailure(
        'joinLobby',
        'A song is already selected, please try later.',
      );
    }

    lobby.machines[socketId] = {
      ...machine,
      socketId,
    };
    ROOMMAN.join(socketId, normalizedCode);
    LOBBYMAN.machineConnections[socketId] = normalizedCode;

    this.updateLobbyActivity(normalizedCode);
    this.broadcastLobbyState(normalizedCode);

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
    if (lobby === undefined) {
      return responseStatusFailure('updateMachine', 'Lobby not found');
    }

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

    this.updateLobbyActivity(lobby.code);
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
    if (lobby === undefined) {
      return responseStatusFailure('selectSong', 'Lobby not found');
    }
    if (lobby.songInfo) {
      return responseStatusFailure('selectSong', 'Song already selected');
    }
    lobby.songInfo = songInfo;

    this.updateLobbyActivity(code);
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
    const code = LOBBYMAN.machineConnections[socketId];
    let left = false;
    left = this.disconnectMachine(socketId);
    if (code) {
      this.updateLobbyActivity(code);
    }
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
  ): Promise<EventMessage<ResponseStatusPayload> | undefined> {
    if (!canJoinLobby(code, password)) {
      return responseStatusFailure(
        'spectateLobby',
        'No lobby found with code ' + code,
      );
    }

    if (socketId in LOBBYMAN.machineConnections) {
      return responseStatusFailure(
        'spectateLobby',
        'Connection is already being used to play in a lobby, cannot spectate.',
      );
    }

    if (socketId in LOBBYMAN.spectatorConnections) {
      // A spectator can only spectate one lobby at a time.
      disconnectSpectator(socketId);
    }
    const lobby = LOBBYMAN.lobbies[code.toUpperCase()];
    lobby.spectators[socketId] = {
      ...spectator,
      socketId,
    };
    ROOMMAN.join(socketId, code);
    LOBBYMAN.spectatorConnections[socketId] = code;

    // Broadcasts an updated spectator count to all machines
    // and the initial lobby state for the newly-added spectator
    this.updateLobbyActivity(code.toUpperCase());
    this.broadcastLobbyState(code);

    return undefined;
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
    if (lobby === undefined) {
      return null;
    }
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

    return {
      event: 'lobbyState',
      data: {
        players: players.sort((p1, p2) => {
          if (p1.exScore && p2.exScore) {
            return p2.exScore - p1.exScore;
          }
          return p1.profileName > p2.profileName ? 1 : -1;
        }),
        spectators: Object.values(lobby.spectators).map((s) => s.profileName),
        songInfo,
        code,
      },
    };
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
      delete ROOMMAN.rooms[code];
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
