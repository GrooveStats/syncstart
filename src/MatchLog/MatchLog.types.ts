import { PlayerId } from '../types/models.types';

/** A single row in the `scores` table. */
export interface ScoreRow {
  id: number;
  matchId: string;
  dateAdded: number;
  lobbyCode: string;
  playerId: PlayerId;
  profileName: string;
  score: number | null;
  exScore: number | null;
  fantasticPlus: number | null;
  fantastics: number | null;
  excellents: number | null;
  greats: number | null;
  decents: number | null;
  wayOffs: number | null;
  misses: number | null;
  totalSteps: number | null;
  minesHit: number | null;
  totalMines: number | null;
  holdsHeld: number | null;
  totalHolds: number | null;
  rollsHeld: number | null;
  totalRolls: number | null;
  songTitle: string | null;
  songArtist: string | null;
  songPath: string | null;
}

/** A single player's score within a match. */
export type PlayerScore = Omit<ScoreRow, 'matchId' | 'dateAdded' | 'lobbyCode'>;

/** A row to be inserted into the `scores` table (the `id` is auto-assigned). */
export type NewScoreRow = Omit<ScoreRow, 'id'>;

/** A completed match, made up of one score per player. */
export interface Match {
  matchId: string;
  dateAdded: number;
  lobbyCode: string;
  /** True if every player's songTitle, songArtist, and songPath match. */
  isSameSong: boolean;
  scores: PlayerScore[];
}
