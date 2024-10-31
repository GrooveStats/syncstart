import { Machine } from '../types/models.types';

export type MessageType = 'createLobby' | 'lobbyCreated' | 'clientDisconnected';

export type MessagePayload =
  | CreateLobbyPayload
  | LobbyCreatedPayload
  | ClientDisconnectedPayload;

export interface Message {
  type: MessageType;
  payload: MessagePayload;
}

export interface CreateLobbyPayload {
  machine: Machine;
  password: string;
}

export interface LobbyCreatedPayload {
  code: Machine;
}

export interface ClientDisconnectedPayload {
  reason: string;
}
