import {
  LobbyCode,
  LobbyInfo,
  Machine,
  Spectator,
} from '../types/models.types';

export type MessageType =
  | 'createLobby'
  | 'lobbyCreated'
  | 'joinLobby'
  | 'lobbyJoined'
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
  | 'startSong';

export type MessagePayload =
  | CreateLobbyPayload
  | LobbyCreatedPayload
  | JoinLobbyPayload
  | LobbyJoinedPayload
  | LeaveLobbyPayload
  | LobbyLeftPayload
  | SearchLobbyPayload
  | LobbySearchedPayload
  | ClientDisconnectedPayload
  | ReadyUpPayload
  | ReadyUpResultPayload
  | LobbyStatePayload
  | StartSongPayload;

export interface Message<T = MessagePayload> {
  type: MessageType;
  payload: T;
}

export interface CreateLobbyPayload {
  machine: Machine;
  password: string;
}

export interface LobbyCreatedPayload {
  code: LobbyCode;
}

export interface JoinLobbyPayload {
  machine: Machine;
  code: LobbyCode;
  password: string;
}

export interface LobbyJoinedPayload {
  joined: boolean;
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

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ReadyUpPayload {}

export interface ReadyUpResultPayload {
  ready: boolean;
}

export interface ClientDisconnectedPayload {
  reason: string;
}

export interface LobbyStatePayload {
  machines: Machine[];
}

export interface StartSongPayload {
  start: boolean;
}
