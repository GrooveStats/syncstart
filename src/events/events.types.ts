import {
  LobbyCode,
  LobbyInfo,
  Machine,
  Player,
  PlayerId,
  SongInfo,
  Spectator,
} from '../types/models.types';
import { Match } from '../MatchLog/MatchLog.types';

export type EventType =
  | 'createLobby'
  | 'joinLobby'
  | 'lobbyJoined'
  | 'updateMachine'
  | 'machineUpdated'
  | 'leaveLobby'
  | 'lobbyLeft'
  | 'spectateLobby'
  | 'lobbySpectated'
  | 'searchLobby'
  | 'lobbySearched'
  | 'clientDisconnected'
  | 'readyUp'
  | 'readyUpResult'
  | 'lobbyState'
  | 'selectSong'
  | 'responseStatus'
  | 'startSong'
  | 'matchLogged';

export type EventData =
  | CreateLobbyData
  | JoinLobbyPayload
  | LobbyJoinedPayload
  | UpdateMachinePayload
  | LeaveLobbyPayload
  | LobbyLeftPayload
  | SearchLobbyPayload
  | LobbySearchedPayload
  | ClientDisconnectedPayload
  | ReadyUpPayload
  | ReadyUpResultPayload
  | LobbyStatePayload
  | SelectSongPayload
  | StartSongPayload
  | MatchLoggedPayload;

export interface EventMessage<T = EventData> {
  event: EventType;
  data: T;
}

export interface CreateLobbyData {
  machine: Omit<Machine, 'socketId'>;
  password: string;
}

export interface JoinLobbyPayload {
  machine: Omit<Machine, 'socketId'>;
  code: LobbyCode;
  password: string;
}

export interface LobbyJoinedPayload {
  joined: boolean;
  message?: string;
}

export interface UpdateMachinePayload {
  machine: Omit<Machine, 'socketId'>;
}

export interface ResponseStatusPayload {
  event: EventType;
  success: boolean;
  message?: string;
}

export interface SelectSongPayload {
  songInfo: SongInfo;
}

export interface SpectateLobbyPayload {
  spectator: Spectator;
  code: LobbyCode;
  password: string;
}

export interface LobbySpectatedPayload {
  spectators: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SearchLobbyPayload {}

export interface LobbySearchedPayload {
  lobbies: LobbyInfo[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface LeaveLobbyPayload {}

export interface LobbyLeftPayload {
  left: boolean;
}

export interface ReadyUpPayload {
  playerId: PlayerId;
}

export interface ReadyUpResultPayload {
  ready: boolean;
}

export interface ClientDisconnectedPayload {
  reason: string;
}

export interface LobbyStatePayload {
  players: Array<Player>;
  spectators: Array<string>;
  code: LobbyCode;
  songInfo?: SongInfo;
}

export interface StartSongPayload {
  start: boolean;
}

export type MatchLoggedPayload = Match;
