import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { LOBBYMAN } from '../types/models.types';
import {
  CreateLobbyPayload,
  LeaveLobbyPayload,
  LobbyCreatedPayload,
  LobbyLeftPayload,
  LobbySearchedPayload,
  LobbySpectatedPayload,
  ResponseStatus,
  Message,
  SearchLobbyPayload,
  SpectateLobbyPayload,
  UpdateMachinePayload,
} from './events.types';
import { WebSocket } from 'ws';
import { WsAdapter } from '@nestjs/platform-ws';

const port = 3001;

describe('EventsGateway', () => {
  let app: INestApplication;
  let client: WebSocket;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    await app.listen(port);
  });

  beforeEach(async () => {
    // Clear out data before every test.
    LOBBYMAN.lobbies = {};
    LOBBYMAN.machineConnections = {};
    LOBBYMAN.spectatorConnections = {};

    // Create a new client
    client = new WebSocket('ws://localhost:' + port);
    client.on('error', (error) => {
      console.error('WebSocket Error:', error);
    });
    await new Promise((resolve) => {
      client.on('open', resolve);
    });
  });

  describe('generalLobbyUsage', () => {
    it('createLobby', async () => {
      console.log('Create Lobby');

      const create = await send<CreateLobbyPayload, LobbyCreatedPayload>(
        client,
        {
          type: 'createLobby',
          payload: {
            machine: { player1: { playerId: 'P1', profileName: 'teejusb' } },
            password: '',
          },
        },
      );
      expect(create.type).toBe('lobbyCreated');
      expect(create.payload).toHaveProperty('code');
      expect(typeof create.payload.code).toBe('string');
      expect(create.payload.code.length).toBe(4);

      const search = await send<SearchLobbyPayload, LobbySearchedPayload>(
        client,
        {
          type: 'searchLobby',
          payload: {},
        },
      );
      expect(search.type).toBe('lobbySearched');
      expect(search.payload.lobbies.length).toBe(1);
      expect(search.payload.lobbies[0].code).toBe(create.payload.code);
      expect(search.payload.lobbies[0].playerCount).toBe(1);
      expect(search.payload.lobbies[0].spectatorCount).toBe(0);

      const spectate = await send<SpectateLobbyPayload, LobbySpectatedPayload>(
        client,
        {
          type: 'spectateLobby',
          payload: {
            spectator: {
              profileName: 'E.Norma',
            },
            code: search.payload.lobbies[0].code,
            password: '',
          },
        },
      );
      expect(spectate.type).toBe('lobbySpectated');
      expect(spectate.payload.spectators).toBe(0); // Spectate should fail as a player can't also be a spectator.

      const client2 = new WebSocket('ws://localhost:' + port);
      await new Promise((resolve) => {
        client2.on('open', resolve);
      });

      const spectate2 = await send<SpectateLobbyPayload, LobbySpectatedPayload>(
        client2,
        {
          type: 'spectateLobby',
          payload: {
            spectator: {
              profileName: 'Brat',
            },
            code: search.payload.lobbies[0].code,
            password: '',
          },
        },
      );
      expect(spectate2.type).toBe('lobbySpectated');
      expect(spectate2.payload.spectators).toBe(1); // socket2 is a different connection, so we can spectate now.

      const search2 = await send<SearchLobbyPayload, LobbySearchedPayload>(
        client,
        {
          type: 'searchLobby',
          payload: {},
        },
      );
      expect(search2.type).toBe('lobbySearched');
      expect(search2.payload.lobbies.length).toBe(1);
      expect(search2.payload.lobbies[0].code).toBe(create.payload.code);
      expect(search2.payload.lobbies[0].playerCount).toBe(1);
      expect(search2.payload.lobbies[0].spectatorCount).toBe(1);

      const leave = await send<LeaveLobbyPayload, LobbyLeftPayload>(client, {
        type: 'leaveLobby',
        payload: {},
      });
      expect(leave.type).toBe('lobbyLeft');
      expect(leave.payload.left).toBeTruthy();

      const search3 = await send<SearchLobbyPayload, LobbySearchedPayload>(
        client,
        {
          type: 'searchLobby',
          payload: {},
        },
      );
      expect(search3.type).toBe('lobbySearched');
      expect(search3.payload.lobbies.length).toBe(0);

      client2.close();
    });

    it('updateMachine', async () => {
      const create = await send<CreateLobbyPayload, LobbyCreatedPayload>(
        client,
        {
          type: 'createLobby',
          payload: {
            machine: { player1: { playerId: 'P1', profileName: 'teejusb' } },
            password: '',
          },
        },
      );
      const payload: UpdateMachinePayload = {
        machine: {
          player1: { playerId: 'P1', profileName: 'teejusb' },
          player2: { playerId: 'P2', profileName: 'Moistbruh' },
        },
      };
      await send<UpdateMachinePayload, ResponseStatus>(client, {
        type: 'updateMachine',
        payload,
      });

      const lobby = LOBBYMAN.lobbies[create.payload.code];
      const machine = Object.values(lobby.machines)[0];
      expect(machine).toEqual(payload.machine);
    });
  });

  afterEach(() => {
    client.close();
  });

  afterAll(async () => {
    await app.close();
  });
});

function send<T, R>(
  client: WebSocket,
  message: Message<T>,
): Promise<Message<R>> {
  return new Promise((resolve) => {
    client.on('message', (response: Message) => {
      resolve(JSON.parse(response.toString()));
    });
    client.send(JSON.stringify(message));
  });
}
