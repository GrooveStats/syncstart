import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { io, Socket } from 'socket.io-client';
import { LobbyInfo, LOBBYMAN } from '../types/models.types';

describe('EventsGateway', () => {
  let app: INestApplication;
  let socket: Socket;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Run tests on a different port than 3000 (the default for this app).
    await app.listen(3001);
  });

  beforeEach(() => {
    // Clear out data before every test.
    LOBBYMAN.lobbies = {};
    LOBBYMAN.activeMachines = {};
    LOBBYMAN.machineConnections = {};

    socket = io('http://localhost:3001');
    socket.connect();
  });

  describe('generalLobbyUsage', () => {
    it('createLobby', async () => {
      const code = await new Promise<string>((resolve) => {
        socket.emit(
          'createLobby',
          { machine: { machineId: '1', player1: { playerName: 'teejusb' } } },
          (data: string) => {
            expect(data.length).toEqual(4);
            resolve(data);
          },
        );
      });

      await new Promise((resolve) => {
        socket.emit('searchLobby', (data: LobbyInfo[]) => {
          expect(data.length).toEqual(1);
          expect(data[0].code).toEqual(code);
          expect(data[0].playerCount).toEqual(1);
          expect(data[0].spectatorCount).toEqual(0);
          resolve(undefined);
        });
      });

      await new Promise((resolve) => {
        socket.emit(
          'spectateLobby',
          { code: code, password: '' },
          (spectatorCount: number) => {
            // Spectate should fail as a player can't also be a spectator.
            expect(spectatorCount).toEqual(0);
            resolve(undefined);
          },
        );
      });

      const socket2 = io('http://localhost:3001');
      socket2.connect();

      await new Promise((resolve) => {
        socket2.emit(
          'spectateLobby',
          { code: code, password: '' },
          (spectatorCount: number) => {
            // socket2 is a different connection, so we can spectate now.
            expect(spectatorCount).toEqual(1);
            resolve(undefined);
          },
        );
      });

      await new Promise((resolve) => {
        socket.emit('searchLobby', (data: LobbyInfo[]) => {
          expect(data.length).toEqual(1);
          expect(data[0].code).toEqual(code);
          expect(data[0].playerCount).toEqual(1);
          expect(data[0].spectatorCount).toEqual(1);
          resolve(undefined);
        });
      });

      await new Promise((resolve) => {
        socket.emit('leaveLobby', { machineId: '1' }, (didLeave: boolean) => {
          console.log('in callback');
          expect(didLeave).toEqual(true);
          resolve(undefined);
        });
      });

      await new Promise((resolve) => {
        socket.emit('searchLobby', (data: LobbyInfo[]) => {
          expect(data.length).toEqual(0);
          resolve(undefined);
        });
      });

      socket2.disconnect();
    });
  });

  afterEach(() => {
    socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });
});
