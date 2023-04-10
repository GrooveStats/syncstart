import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { LOBBYMAN, LobbyInfo, Player } from '../types/models.types';

function GenerateLobbyCode() {
  const lobbyCodeLength = 4;
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < lobbyCodeLength; ++i) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Removes the player from the list of lobbies and the activePlayers list, if
// applicable.
// Destroys the lobby if all players are removed.
function MaybeRemovePlayer(player: Player) {
  if (player.playerId in LOBBYMAN.activePlayers) {
    const code = LOBBYMAN.activePlayers[player.playerId];
    if (code in LOBBYMAN.lobbies[code]) {
      const lobby = LOBBYMAN.lobbies[code];
      if (player.playerId in lobby.players) {
        delete lobby.players[player.playerId];
        console.log('Deleted ' + `${player.playerId}` + 'from ' + `${code}`);
      }

      // No players left in this lobby, destroy it.
      if (Object.keys(lobby.players).length === 0) {
        delete LOBBYMAN.lobbies[code];
        console.log('Deleted lobby ' + `${code}`);
      }
    }
    delete LOBBYMAN.activePlayers[player.playerId];
    console.log('Deleted active player' + `${player.playerId}`);
  }
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('createLobby')
  async createLobby(
    @MessageBody('player') player: Player,
    @MessageBody('password') password?: string,
  ): Promise<string> {
    // A player can only join one lobby at a time.
    MaybeRemovePlayer(player);

    let code = GenerateLobbyCode();
    while (code in LOBBYMAN.lobbies) {
      code = GenerateLobbyCode();
    }

    LOBBYMAN.lobbies[code] = {
      code: code,
      password: password ? password : '',
      players: {
        [player.playerId]: player,
      },
      spectators: [],
    };

    LOBBYMAN.activePlayers[player.playerId] = code;
    console.log('Created lobby ' + code);

    return code;
  }

  @SubscribeMessage('joinLobby')
  async joinLobby(
    @MessageBody('player') player: Player,
    @MessageBody('code') code: string,
    @MessageBody('password') password: string,
  ) {
    // A player can only join one lobby at a time.
    MaybeRemovePlayer(player);

    // Does the lobby we're trying to join exist?
    if (code in LOBBYMAN.lobbies) {
      const lobby = LOBBYMAN.lobbies[code];
      // Join either if the lobby is public, or one has provided a valid
      // password for a private lobby.
      if (!lobby.password || lobby.password === password) {
        LOBBYMAN.lobbies[code].players[player.playerId] = player;
        LOBBYMAN.activePlayers[player.playerId] = code;
        console.log('Player ' + `${player.playerId}` + 'joined ' + `${code}`);
      }
    }
  }

  @SubscribeMessage('leaveLobby')
  async leabeLobby(@MessageBody('player') player: Player) {
    // A player can only join one lobby at a time.
    MaybeRemovePlayer(player);
  }

  @SubscribeMessage('searchLobby')
  async searchLobby(): Promise<LobbyInfo[]> {
    const lobbyInfo: LobbyInfo[] = [];
    for (const lobby of Object.values(LOBBYMAN.lobbies)) {
      lobbyInfo.push({
        code: lobby.code,
        playerCount: Object.keys(lobby.players).length,
      });
    }

    return lobbyInfo;
  }
}
