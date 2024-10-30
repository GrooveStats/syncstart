import { Machine } from '../types/models.types';

export type MessageType = 'createLobby' | 'lobbyCreated';

export type MessagePayload = CreateLobbyPayload | LobbyCreatedPayload;

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
