import { PlayerId } from '../types/models.types';

/** A single row in the `matches` table. */
export interface MatchRow {
  id: string;
  dateAdded: number;
  lobbyCode: string;
  songTitle: string | null;
  songArtist: string | null;
  songPath: string | null;
  totalSteps: number | null;
  totalHolds: number | null;
  totalRolls: number | null;
  totalMines: number | null;
}

/** A single row in the `scores` table. */
export interface ScoreRow {
  id: number;
  matchId: string;
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
  minesHit: number | null;
  holdsHeld: number | null;
  rollsHeld: number | null;
  /** 1 if the sum of judgments matches the match's totalSteps, 0 otherwise. */
  isValid: number;
}

/** A row to be inserted into the `matches` table. */
export type NewMatchRow = MatchRow;

/** A row to be inserted into the `scores` table (the `id` is auto-assigned). */
export type NewScoreRow = Omit<ScoreRow, 'id'>;

/** A single player's score within a match. */
export type PlayerScore = Omit<ScoreRow, 'matchId'>;

/** A completed match, made up of one score per player. */
export interface Match extends MatchRow {
  scores: PlayerScore[];
}
