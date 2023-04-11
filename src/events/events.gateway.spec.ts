import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { io, Socket } from 'socket.io-client';
import { LobbyInfo, LOBBYMAN, Player } from '../types/models.types';

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
    LOBBYMAN.activePlayers = {};

    socket = io('http://localhost:3001');
    socket.connect();
  });

  describe('generalLobbyUsage', () => {
    it('createLobby', (done) => {
      const player: Player = {
        playerId: 'guid-1',
        profileName: 'teejusb',
      };

      let code = '';
      socket.emit('createLobby', { player: player }, (data: string) => {
        code = data;
        expect(code.length).toEqual(4);
      });
      socket.emit('searchLobby', (data: LobbyInfo[]) => {
        expect(data.length).toEqual(1);
        expect(data[0].code).toEqual(code);
        expect(data[0].playerCount).toEqual(1);
      });
      socket.emit('leaveLobby', { player: player }, () => {
        expect(Object.keys(LOBBYMAN.activePlayers).length).toEqual(0);
      });
      socket.emit('searchLobby', (data: LobbyInfo[]) => {
        expect(data.length).toEqual(0);
        done();
      });
    });
  });

  afterEach(() => {
    socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });
});
