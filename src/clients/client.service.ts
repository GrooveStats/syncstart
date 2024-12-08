import { Injectable } from '@nestjs/common';
import WebSocket = require('ws');
import { EventMessage } from '../events/events.types';
import { SocketId, LobbyCode, ROOMMAN } from '../types/models.types';
import { v4 as uuid } from 'uuid';
@Injectable()
export class ClientService {
  // Mapping from socketId to the lobby code for the spectators.
  private clients: Record<SocketId, WebSocket> = {};

  getSocketId(targetSocket: WebSocket): SocketId {
    for (const [socketId, socket] of Object.entries(this.clients)) {
      if (socket === targetSocket) return socketId;
    }
    throw new Error('Socket not found');
  }

  /** Sends a message to all connected clients */
  sendAll(response: EventMessage) {
    for (const client of Object.values(this.clients)) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(response));
      }
    }
  }

  /** Sends a message to a specific socket */
  sendSocket(response: EventMessage, socketId: SocketId) {
    const socket = this.clients[socketId];
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send to socket, socket is not connected');
      return;
    }
    socket.send(JSON.stringify(response));
  }

  /** Sends a message to all clients in a particular lobby */
  sendLobby(response: EventMessage, code: LobbyCode) {
    for (const [socketId, socket] of Object.entries(this.clients)) {
      // skip clients not in the lobby
      if (!ROOMMAN.isJoined(socketId, code)) return;

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(response));
      }
    }
  }

  disconnect(socketId: SocketId, reason?: string) {
    console.log('Client disconnecting', socketId);
    if (!this.clients[socketId]) {
      console.warn(`Client ${socketId} not connected`);
      return;
    }

    const message: EventMessage = {
      event: 'clientDisconnected',
      data: { reason: reason || 'Just because' },
    };

    const client = this.clients[socketId];
    if (!client) return;

    if (client.readyState === WebSocket.OPEN) {
      client.close(1000, JSON.stringify(message));
    }
    delete this.clients[socketId];
  }

  connect(socket: WebSocket): string {
    // Assert we're not already connected
    console.log('Client connecting');
    const entry = Object.entries(this.clients).find(
      ([, value]) => socket === value,
    );
    if (entry) {
      console.warn(`Socket ${entry[0]} is already connected`);
      return entry[0];
    }

    // Generate an id for the entry, set and return it
    const socketId = uuid();
    this.clients[socketId] = socket;
    console.log('Socket connected: ', socketId);
    return socketId;
  }
}
