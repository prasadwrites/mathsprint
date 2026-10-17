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
  /** Total time across all visits; absent on sessions recorded before students could revisit questions. */
  spentMs?: number;
}

export type EndReason = "finished" | "timeout" | "quit";

/** learn: no clock. practice: the student's own limit. challenge: one minute per question. */
export type Mode = "learn" | "practice" | "challenge";

export interface ConceptStat {
  attempted: number;
  correct: number;
  seconds: number;
}

export interface PracticeSession {
  id: string;
  ownerId: string;
  deckId: string;
  deckTitle: string;
  mode: Mode;
  questionIds: string[];
  timeLimitSec: number;
  startedAtMs: number;
  /** The question on screen. Students can move back and forth, so this is not a count of finished questions. */
  currentIndex: number;
  /** When the visit to the current question began. */
  visitStartedAt?: number;
  answers: Record<string, string>;
  timings: Record<string, QuestionTiming>;
  status: "active" | "completed";
  endReason?: EndReason;
  usedSec?: number;
  score?: number;
  accuracy?: number;
  results?: Record<string, boolean>;
  conceptStats?: Record<string, ConceptStat>;
}

export type PlanId = "free" | "pro" | "promax";

/** The signed-in student's own account, from the get_account function. */
export interface AccountSummary {
  plan: PlanId;
  planLabel: string;
  status: "active" | "suspended";
  decksCreated: number;
  maxDecks: number;
  maxQuestions: number;
  isAdmin: boolean;
  /** True when the admin gave this account its own access code. */
  hasOwnCode: boolean;
  /** Everyone's first 5 decks need no access code. */
  needsCode: boolean;
  codeFreeLeft: number;
  /** Extra decks earned from friends who joined, already counted in maxDecks. */
  bonusDecks: number;
  /** Admin: requests waiting for a reply. Students: their open request and unread replies. */
  upgrade?: { waiting?: number; pendingPlan?: PlanId | null; unreadReplies?: number };
}

export interface UpgradeRequest {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  currentPlan: PlanId;
  requestedPlan: PlanId;
  message: string;
  status: "pending" | "replied";
  reply: string;
  approved: boolean;
  userRead: boolean;
  createdAt: number | null;
  repliedAt: number | null;
  updatedAt: number | null;
  /** Every message on the request, oldest first. */
  thread: RequestMessage[];
}

export interface RequestMessage {
  from: "student" | "admin";
  text: string;
  at: number | null;
  /** Set on the admin message that upgraded the plan. */
  approved?: boolean;
}

/** One row on the admin accounts page. Times are milliseconds since the epoch. */
export interface AdminAccount extends Omit<AccountSummary, "hasOwnCode" | "upgrade"> {
  uid: string;
  email: string;
  displayName: string;
  accessCode: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  /** Time actively using the app, counted a minute at a time. */
  activeSeconds: number;
  todaySeconds: number;
  /** The last 7 days, today included (UTC days). */
  weekSeconds: number;
  lastActiveAt: number | null;
  invitesJoined: number;
}

export interface Invite {
  token: string;
  email: string;
  status: "invited" | "joined";
  createdAt: number | null;
  joinedAt: number | null;
}

export interface PlanLimits {
  label: string;
  max_decks: number;
  max_questions: number;
}

/** Mirrors PLANS in functions/accounts.py, for showing the choices. The server enforces the limits. */
export const PLANS: { id: PlanId; label: string; decks: number; questions: number }[] = [
  { id: "free", label: "Free", decks: 5, questions: 20 },
  { id: "pro", label: "Pro", decks: 50, questions: 120 },
  { id: "promax", label: "Pro Max", decks: 100, questions: 200 },
];

/** A Pro or Pro Max user's contact group, such as a class. */
export interface Group {
  id: string;
  name: string;
  emails: string[];
  updatedAt: number | null;
}

/** A deck assigned to a group. */
export interface GroupTest {
  id: string;
  deckId: string;
  deckTitle: string;
  groupId: string;
  groupName: string;
  questionCount: number;
  /** 0 means no time limit. */
  timeLimitSec: number;
  createdAt: number | null;
  assigned: number;
  completed: number;
}

/** One group member's link, code and result, as the test's owner sees it. */
export interface TestTaker {
  token: string;
  email: string;
  code: string;
  status: "assigned" | "started" | "completed";
  score: number | null;
  usedSec: number | null;
  /** Sent more than two minutes after the time ran out. */
  late: boolean;
  /** Too many wrong codes; a new code unlocks it. */
  locked: boolean;
  startedAt: number | null;
  completedAt: number | null;
  answers: Record<string, string>;
  results: Record<string, boolean>;
}

export interface TestResults {
  test: GroupTest;
  questions: { prompt: string; math: string; type: string; answerDisplay: string; concept: string }[];
  takers: TestTaker[];
  overall: {
    assigned: number;
    started: number;
    completed: number;
    averageScore: number | null;
    averageSec: number | null;
    /** How many finishers got each question right. */
    questionCorrect: number[];
  };
}

/** What a group member sees: the test, then its questions (without answers), then only their own result. */
export interface OpenTest {
  title: string;
  from: string;
  groupName: string;
  email: string;
  questionCount: number;
  timeLimitSec: number;
  status: TestTaker["status"];
  elapsedSec?: number;
  remainingSec?: number | null;
  questions?: { prompt: string; math: string; type: "numeric" | "choice"; choices: string[]; answerCount: number }[];
  result?: OwnTestResult;
}

export interface OwnTestResult {
  score: number;
  total: number;
  usedSec: number;
  questions: { prompt: string; math: string; answer: string; correct: boolean; answerDisplay: string; steps: SolutionStep[] }[];
}

/** Groups and group tests come with Pro and Pro Max. The server checks this too. */
export const canUseGroups = (a: AccountSummary | null) => !!a && (a.isAdmin || a.plan === "pro" || a.plan === "promax");
