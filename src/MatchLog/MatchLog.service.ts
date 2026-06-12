import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import Database = require('better-sqlite3');
import { v4 as uuidv4 } from 'uuid';
import { omit } from 'lodash';
import { Lobby, Player } from '../types/models.types';
import { Match, NewScoreRow, ScoreRow } from './MatchLog.types';

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
       VALUES
        (@matchId, @dateAdded, @lobbyCode, @playerId, @profileName, @score, @exScore,
         @fantasticPlus, @fantastics, @excellents, @greats, @decents, @wayOffs,
         @misses, @totalSteps, @minesHit, @totalMines, @holdsHeld, @totalHolds,
         @rollsHeld, @totalRolls, @songTitle, @songArtist, @songPath)`,
    );

    const insertManyScores = this.db.transaction(() => {
      for (const player of players) {
        const judgments = player.judgments;
        const row: NewScoreRow = {
          matchId,
          dateAdded,
          lobbyCode: lobby.code,
          playerId: player.playerId,
          profileName: player.profileName,
          score: player.score ?? null,
          exScore: player.exScore ?? null,
          fantasticPlus: judgments?.fantasticPlus ?? null,
          fantastics: judgments?.fantastics ?? null,
          excellents: judgments?.excellents ?? null,
          greats: judgments?.greats ?? null,
          decents: judgments?.decents ?? null,
          wayOffs: judgments?.wayOffs ?? null,
          misses: judgments?.misses ?? null,
          totalSteps: judgments?.totalSteps ?? null,
          minesHit: judgments?.minesHit ?? null,
          totalMines: judgments?.totalMines ?? null,
          holdsHeld: judgments?.holdsHeld ?? null,
          totalHolds: judgments?.totalHolds ?? null,
          rollsHeld: judgments?.rollsHeld ?? null,
          totalRolls: judgments?.totalRolls ?? null,
          songTitle: lobby.songInfo?.title ?? null,
          songArtist: lobby.songInfo?.artist ?? null,
          songPath: lobby.songInfo?.songPath ?? null,
        };
        insertQuery.run(row);
      }
    });
    insertManyScores();
  }

  /**
   * Returns all logged matches, sorted reverse chronologically (most recent
   * first).
   */
  getMatches(): Match[] {
    const rows = this.db
      .prepare<[], ScoreRow>(
        'SELECT * FROM scores ORDER BY dateAdded DESC, id ASC',
      )
      .all();

    const matchesById = new Map<string, Match>();
    for (const row of rows) {
      let match = matchesById.get(row.matchId);
      if (!match) {
        match = {
          matchId: row.matchId,
          dateAdded: row.dateAdded,
          lobbyCode: row.lobbyCode,
          isSameSong: true,
          scores: [],
        };
        matchesById.set(row.matchId, match);
      }

      match.scores.push(omit(row, ['matchId', 'dateAdded', 'lobbyCode']));
    }

    for (const match of matchesById.values()) {
      const [first, ...rest] = match.scores;
      match.isSameSong = rest.every(
        (score) =>
          score.songTitle === first.songTitle &&
          score.songArtist === first.songArtist &&
          score.songPath === first.songPath,
      );
    }

    return Array.from(matchesById.values());
  }

  onApplicationShutdown(): void {
    this.db.close();
  }
}
