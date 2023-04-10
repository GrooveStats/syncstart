import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { io, Socket } from 'socket.io-client';
import { LOBBYMAN } from '../types/models.types';

describe('EventsGateway', () => {
  let app: INestApplication;
  let socket: Socket;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    LOBBYMAN.lobbies = {};
    LOBBYMAN.activePlayers = {};
    await app.listen(3000);
  });

  beforeEach(() => {
    socket = io('http://localhost:3000');
    socket.connect();
  });

  describe('findAll', () => {
    it('should receive 3 numbers', (done) => {
      let code = '';
      socket.emit('createLobby', {
        player: {
          playerId: 'guid-1',
          profileName: 'teejusb',
        }
      });
      socket.on('createLobby', (data) => {
        code = data;
        expect(code).toEqual(4);
      });
      socket.emit('searchLobby');
      socket.on('searchLobby', (data) => {
        expect(data.length).toEqual(1);
        expect(data[0].code).toEqual(code);
        expect(data[0].numberPlayers).toEqual(1);
      });
      done();
    });
  });

  afterEach(() => {
    socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });
});
