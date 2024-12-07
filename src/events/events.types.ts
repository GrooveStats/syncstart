import {
  LobbyCode,
  LobbyInfo,
  Machine,
  PlayerId,
  Spectator,
} from '../types/models.types';

export type MessageType =
  | 'createLobby'
  | 'lobbyCreated'
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
  | 'sendLobby'
  | 'startSong';

export type MessagePayload =
  | CreateLobbyPayload
  | LobbyCreatedPayload
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
  | SendLobbyPayload
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
  machine: Omit<Machine, 'socketId'>;
  code: LobbyCode;
  password: string;
}

export interface UpdateMachinePayload {
  machine: Omit<Machine, 'socketId'>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MachineUpdatedPayload {
  updated: boolean;
  message?: string;
}

export interface LobbyJoinedPayload {
  joined: boolean;
  message?: string;
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

export interface SendLobbyPayload {
  machines: Machine[];
}

export interface StartSongPayload {
  start: boolean;
}
