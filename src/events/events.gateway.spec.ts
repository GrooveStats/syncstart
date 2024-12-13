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
import { omit } from 'lodash';

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
      const create = await send<CreateLobbyData, undefined>(client, {
        event: 'createLobby',
        data: {
          machine: {
            player1: {
              playerId: 'P1',
              profileName: 'teejusb',
              screenName: 'ScreenSelectMusic',
              ready: false,
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
      const code = Object.keys(LOBBYMAN.lobbies)[0];

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
              ready: false,
            },
          },
          password: '',
        },
      });
      const update1: UpdateMachinePayload = {
        machine: {
          player1: {
            playerId: 'P1',
            profileName: 'teejusb',
            screenName: 'ScreenGameplay',
            ready: false,
            score: 0.99,
            songProgression: {
              currentTime: 1,
              totalTime: 2,
            },
          },
          player2: {
            playerId: 'P2',
            profileName: 'Moistbruh',
            screenName: 'ScreenGameplay',
            ready: false,
            score: 0.99,
          },
        },
      };
      await send<UpdateMachinePayload, ResponseStatusPayload>(client, {
        event: 'updateMachine',
        data: update1,
      });
      const lobby = Object.values(LOBBYMAN.lobbies)[0];
      const machine = Object.values(lobby.machines)[0];
      expect(omit(machine, 'socketId')).toEqual(update1.machine);

      // If one player goes back to SongSelect (I know, technically not possible for a single machine)
      // The songInfo/scores should persist
      const update2: UpdateMachinePayload = {
        machine: {
          player1: {
            playerId: 'P1',
            profileName: 'teejusb',
            screenName: 'ScreenSelectMusic',
            ready: false,
          },
          player2: {
            playerId: 'P2',
            profileName: 'Moistbruh',
            screenName: 'ScreenGameplay',
            ready: false,
            score: 0.99,
          },
        },
      };
      await send<UpdateMachinePayload, ResponseStatusPayload>(client, {
        event: 'updateMachine',
        data: update2,
      });

      expect(machine.player1).toBeDefined();
      expect(machine.player1?.screenName).toEqual('ScreenSelectMusic');
      expect(machine.player1?.score).toBeDefined();
      expect(machine.player1?.songProgression).toBeDefined();

      // Now we go back to select music, it should wipe songInfo/scores
      const update3: UpdateMachinePayload = {
        machine: {
          player1: {
            playerId: 'P1',
            profileName: 'teejusb',
            screenName: 'ScreenSelectMusic',
            ready: false,
          },
          player2: {
            playerId: 'P2',
            profileName: 'Moistbruh',
            screenName: 'ScreenSelectMusic',
            ready: false,
          },
        },
      };
      await send<UpdateMachinePayload, ResponseStatusPayload>(client, {
        event: 'updateMachine',
        data: update3,
      });

      expect(machine.player1).toBeDefined();
      expect(machine.player1?.screenName).toEqual('ScreenSelectMusic');
      expect(machine.player1?.score).toBeUndefined();
      expect(machine.player1?.songProgression).toBeUndefined();
    });
  });

  it('selectSong', async () => {
    await send<CreateLobbyData, undefined>(client, {
      event: 'createLobby',
      data: {
        machine: {
          player1: {
            playerId: 'P1',
            profileName: 'teejusb',
            screenName: 'ScreenSelectMusic',
            ready: false,
          },
        },
        password: '',
      },
    });

    // Initially no song
    const [, lobby] = Object.entries(LOBBYMAN.lobbies)[0];
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
