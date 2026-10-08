export type Difficulty = "Easy" | "Medium" | "Hard" | "Mixed";

export interface SolutionStep {
  description: string;
  expression: string;
}

export interface Question {
  id: string;
  order: number;
  prompt: string;
  math: string;
  type: "numeric" | "choice";
  choices: string[];
  answerValues: number[];
  answerChoice: string;
  answerDisplay: string;
  tolerance: number;
  concept: string;
  difficulty: Exclude<Difficulty, "Mixed">;
  steps: SolutionStep[];
  verified: boolean;
}

export interface Deck {
  id: string;
  ownerId: string;
  title: string;
  topic: string;
  level: string;
  difficulty: Difficulty;
  topics: string[];
  questionCount: number;
  source: "ai" | "sample";
  createdAt: Date | null;
}

/** Times are milliseconds since the session started, so they survive clock changes and refreshes. */
export interface QuestionTiming {
  startedAt: number;
  answeredAt?: number;
}

export type EndReason = "finished" | "timeout" | "quit";

export interface PracticeSession {
  id: string;
  ownerId: string;
  deckId: string;
  deckTitle: string;
  questionIds: string[];
  timeLimitSec: number;
  startedAtMs: number;
  currentIndex: number;
  answers: Record<string, string>;
  timings: Record<string, QuestionTiming>;
  status: "active" | "completed";
  endReason?: EndReason;
  usedSec?: number;
  score?: number;
  accuracy?: number;
  results?: Record<string, boolean>;
}
