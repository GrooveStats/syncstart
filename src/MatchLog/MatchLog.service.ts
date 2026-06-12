import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import Database = require('better-sqlite3');
import { v4 as uuidv4 } from 'uuid';
import { Lobby, Player } from '../types/models.types';

@Injectable()
export class MatchLogService implements OnApplicationShutdown {
  private readonly db: Database.Database;

  constructor() {
    const dbPath =
      process.env.SQLITE3_DB_PATH ||
      path.join(__dirname, '../../data/matches.db');
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matchId TEXT NOT NULL,
        dateAdded INTEGER NOT NULL,
        lobbyCode TEXT NOT NULL,
        playerId TEXT NOT NULL,
        profileName TEXT NOT NULL,
        score INTEGER,
        exScore INTEGER,
        fantasticPlus INTEGER,
        fantastics INTEGER,
        excellents INTEGER,
        greats INTEGER,
        decents INTEGER,
        wayOffs INTEGER,
        misses INTEGER,
        holdsHeld INTEGER,
        rollsHeld INTEGER,
        minesHit INTEGER,
        songTitle TEXT,
        songArtist TEXT,
        songPath TEXT,
        totalSteps INTEGER,
        totalHolds INTEGER,
        totalRolls INTEGER,
        totalMines INTEGER
      )
    `);
  }

  /**
   * Records each player's score for a completed match, once all players in
   * the lobby have reached the evaluation/results screen. Every row from the
   * same match shares the same matchId and dateAdded values.
   */
  logMatch(lobby: Lobby): void {
    const players = Object.values(lobby.machines).flatMap((machine) =>
      [machine.player1, machine.player2].filter(
        (player): player is Player => player !== undefined,
      ),
    );

    const matchId = uuidv4();
    const dateAdded = Date.now();
    const insertQuery = this.db.prepare(
      `INSERT INTO scores
        (matchId, dateAdded, lobbyCode, playerId, profileName, score, exScore,
         fantasticPlus, fantastics, excellents, greats, decents, wayOffs,
         misses, totalSteps, minesHit, totalMines, holdsHeld, totalHolds,
         rollsHeld, totalRolls, songTitle, songArtist, songPath)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertManyScores = this.db.transaction(() => {
      for (const player of players) {
        const judgments = player.judgments;
        insertQuery.run(
          matchId,
          dateAdded,
          lobby.code,
          player.playerId,
          player.profileName,
          player.score ?? null,
          player.exScore ?? null,
          judgments?.fantasticPlus ?? null,
          judgments?.fantastics ?? null,
          judgments?.excellents ?? null,
          judgments?.greats ?? null,
          judgments?.decents ?? null,
          judgments?.wayOffs ?? null,
          judgments?.misses ?? null,
          judgments?.totalSteps ?? null,
          judgments?.minesHit ?? null,
          judgments?.totalMines ?? null,
          judgments?.holdsHeld ?? null,
          judgments?.totalHolds ?? null,
          judgments?.rollsHeld ?? null,
          judgments?.totalRolls ?? null,
          lobby.songInfo?.title ?? null,
          lobby.songInfo?.artist ?? null,
          lobby.songInfo?.songPath ?? null,
        );
      }
    });
    insertManyScores();
  }

  onApplicationShutdown(): void {
    this.db.close();
  }
}
