import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { LOBBYMAN } from '../types/models.types';
import {
  CreateLobbyData,
  LeaveLobbyPayload,
  LobbyLeftPayload,
  LobbySearchedPayload,
  LobbySpectatedPayload,
  ResponseStatusPayload,
  EventMessage,
  SearchLobbyPayload,
  SpectateLobbyPayload,
  UpdateMachinePayload,
  SelectSongPayload,
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

      const create = await send<CreateLobbyData, undefined>(client, {
        event: 'createLobby',
        data: {
          machine: {
            player1: {
              playerId: 'P1',
              profileName: 'teejusb',
              screenName: 'ScreenSelectMusic',
            },
          },
          password: '',
        },
      });
      expect(create.event).toBe('lobbyState');
      expect(create.data).toHaveProperty('code');

      const search = await send<SearchLobbyPayload, LobbySearchedPayload>(
        client,
        {
          event: 'searchLobby',
          data: {},
        },
      );
      expect(search.event).toBe('lobbySearched');
      expect(search.data.lobbies.length).toBe(1);
      const code = Object.values(LOBBYMAN.lobbies)[0].code;

      expect(search.data.lobbies[0].code).toBe(code);
      expect(search.data.lobbies[0].playerCount).toBe(1);
      expect(search.data.lobbies[0].spectatorCount).toBe(0);

      const spectate = await send<SpectateLobbyPayload, LobbySpectatedPayload>(
        client,
        {
          event: 'spectateLobby',
          data: {
            spectator: {
              profileName: 'E.Norma',
            },
            code: search.data.lobbies[0].code,
            password: '',
          },
        },
      );
      expect(spectate.event).toBe('lobbySpectated');
      expect(spectate.data.spectators).toBe(0); // Spectate should fail as a player can't also be a spectator.

      const client2 = new WebSocket('ws://localhost:' + port);
      await new Promise((resolve) => {
        client2.on('open', resolve);
      });

      const spectate2 = await send<SpectateLobbyPayload, LobbySpectatedPayload>(
        client2,
        {
          event: 'spectateLobby',
          data: {
            spectator: {
              profileName: 'Brat',
            },
            code: search.data.lobbies[0].code,
            password: '',
          },
        },
      );
      expect(spectate2.event).toBe('lobbySpectated');
      expect(spectate2.data.spectators).toBe(1); // socket2 is a different connection, so we can spectate now.

      const search2 = await send<SearchLobbyPayload, LobbySearchedPayload>(
        client,
        {
          event: 'searchLobby',
          data: {},
        },
      );
      expect(search2.event).toBe('lobbySearched');
      expect(search2.data.lobbies.length).toBe(1);
      expect(search2.data.lobbies[0].code).toBe(code);
      expect(search2.data.lobbies[0].playerCount).toBe(1);
      expect(search2.data.lobbies[0].spectatorCount).toBe(1);

      const leave = await send<LeaveLobbyPayload, LobbyLeftPayload>(client, {
        event: 'leaveLobby',
        data: {},
      });
      expect(leave.event).toBe('lobbyLeft');
      expect(leave.data.left).toBeTruthy();

      const search3 = await send<SearchLobbyPayload, LobbySearchedPayload>(
        client,
        {
          event: 'searchLobby',
          data: {},
        },
      );
      expect(search3.event).toBe('lobbySearched');
      expect(search3.data.lobbies.length).toBe(0);

      client2.close();
    });

    it('updateMachine', async () => {
      await send<CreateLobbyData, undefined>(client, {
        event: 'createLobby',
        data: {
          machine: {
            player1: {
              playerId: 'P1',
              profileName: 'teejusb',
              screenName: 'ScreenSelectMusic',
            },
          },
          password: '',
        },
      });
      const payload: UpdateMachinePayload = {
        machine: {
          player1: {
            playerId: 'P1',
            profileName: 'teejusb',
            screenName: 'ScreenGameplay',
          },
          player2: {
            playerId: 'P2',
            profileName: 'Moistbruh',
            screenName: 'ScreenGameplay',
          },
        },
      };
      await send<UpdateMachinePayload, ResponseStatusPayload>(client, {
        event: 'updateMachine',
        data: payload,
      });
      const code = LOBBYMAN.lobbies[0].code;

      const lobby = LOBBYMAN.lobbies[code];
      const machine = Object.values(lobby.machines)[0];
      expect(machine).toEqual(payload.machine);
    });
  });

  it('selectSong', async () => {
    const create = await send<CreateLobbyData, undefined>(client, {
      event: 'createLobby',
      data: {
        machine: {
          player1: {
            playerId: 'P1',
            profileName: 'teejusb',
            screenName: 'ScreenSelectMusic',
          },
        },
        password: '',
      },
    });
    const code = Object.values(LOBBYMAN.lobbies)[0].code;

    // Initially no song
    const lobby = LOBBYMAN.lobbies[code];
    expect(lobby.songInfo).toBeUndefined();

    const payload: SelectSongPayload = {
      songInfo: {
        songPath: '11 guys/wowie',
        songLength: 42069,
        title: 'WOWIE',
        artist: 'the guys',
      },
    };

    // First song sets song info
    await send<SelectSongPayload, ResponseStatusPayload>(client, {
      event: 'selectSong',
      data: payload,
    });
    expect(lobby.songInfo).toEqual(payload.songInfo);

    // Second one will fail
    payload.songInfo.title = 'Updated';
    const second = await send<SelectSongPayload, ResponseStatusPayload>(
      client,
      {
        event: 'selectSong',
        data: payload,
      },
    );
    expect(second.data.success).toBe(false);
    expect(lobby.songInfo?.title).toEqual('WOWIE');
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
  message: EventMessage<T>,
): Promise<EventMessage<R>> {
  return new Promise((resolve) => {
    client.on('message', (response: EventMessage) => {
      resolve(JSON.parse(response.toString()));
    });
    client.send(JSON.stringify(message));
  });
}
