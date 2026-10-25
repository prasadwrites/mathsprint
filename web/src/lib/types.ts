export type Difficulty = "Easy" | "Medium" | "Hard" | "Mixed";

export interface SolutionStep {
  description: string;
  expression: string;
}

export interface FigurePoint {
  x: number;
  y: number;
}

/** One thing drawn on a coordinate plane. Graphs come pre-sampled by the server as flat x, y, x, y lists. */
export interface FigureItem {
  type: "function" | "region" | "line" | "segment" | "point";
  label: string;
  dashed: boolean;
  points: FigurePoint[];
  expr?: string;
  paths?: { xy: number[] }[];
  side?: "above" | "below";
}

/** A coordinate plane with graphs. */
export interface PlaneFigure {
  kind: "plane";
  alt: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xGrid: number;
  yGrid: number;
  items: FigureItem[];
}

export interface DiagramPoint {
  name: string;
  x: number;
  y: number;
  show: boolean;
}

/** One mark in a geometry diagram; `of` names the points it uses, in order. */
export interface DiagramItem {
  type: "polygon" | "segment" | "circle" | "right_angle" | "angle_mark" | "angle_label" | "length_label" | "ticks";
  of: string[];
  text: string;
  count: number;
  dashed: boolean;
  shaded: boolean;
}

/** A geometry diagram, drawn to scale. */
export interface GeometryFigure {
  kind: "geometry";
  alt: string;
  points: DiagramPoint[];
  items: DiagramItem[];
}

export type Figure = PlaneFigure | GeometryFigure;

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
  /** A graph or diagram to show with the question; absent for text-only questions. */
  figure?: Figure | null;
  /** The answer is a point (x, y), so its two values are graded in order. */
  pair?: boolean;
}

export interface Deck {
  id: string;
  ownerId: string;
  title: string;
  /** Absent on decks made before subjects existed, which are Math (see subjectOf). */
  subject?: string;
  topic: string;
  level: string;
  difficulty: Difficulty;
  topics: string[];
  questionCount: number;
  source: "ai" | "sample";
  createdAt: Date | null;
  /** Uids of the registered users the owner shared this deck with. */
  sharedWith?: string[];
  /** The owner's name, shown to the people it's shared with. */
  sharedBy?: string;
}

/** Someone a deck is shared with, as its owner sees them. */
export interface DeckShare {
  uid: string;
  email: string;
  name: string;
  sharedAt: number | null;
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
  /** The plan in force now, a promotion's while it lasts. */
  plan: PlanId;
  /** The plan without any promotion; it's back when the promotion ends. */
  basePlan: PlanId;
  planLabel: string;
  promo: { plan: PlanId; planLabel: string; endsAt: number } | null;
  /** A promotion the admin offered that the user hasn't answered yet. */
  offer: PromotionOffer | null;
  /** Admin: reports waiting for a reply. Users: replies they haven't read. */
  reports?: { open?: number; unread?: number };
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
  /** Admin only: the Anthropic credit estimate for the profile menu. */
  credit?: ClaudeCredit;
}

/** The balance the admin entered from the Anthropic console, less what this app's Claude calls cost since. */
export interface ClaudeCredit {
  balanceUsd: number | null;
  spentUsd: number;
  calls: number;
  remainingUsd: number | null;
  setAt: number | null;
  consoleUrl: string;
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
  /** Upgraded by a Square payment, with no approval needed. */
  paid: boolean;
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
  /** Set on the admin message that closed a problem report. */
  resolved?: boolean;
}

export interface PromotionOffer {
  id: string;
  plan: PlanId;
  planLabel: string;
  months: number;
  note: string;
  createdAt: number | null;
}

export interface ProblemReport {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  /** Where in the app the user was when they reported it. */
  page: string;
  status: "open" | "replied" | "resolved";
  thread: RequestMessage[];
  userRead: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

/** One row on the admin accounts page. Times are milliseconds since the epoch. */
export interface AdminAccount extends Omit<AccountSummary, "hasOwnCode" | "upgrade" | "reports"> {
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
  /** The ?ref= tag of the link they signed up from, such as "tutors". */
  signupRef: string | null;
}

export type EngagementChannel = "challenge" | "group" | "share" | "public" | "post" | "invite";

/** One channel's numbers: links made, people who got or opened a deck, who finished it, and new accounts. */
export interface ChannelCounts {
  links: number;
  reached: number;
  completed: number;
  signups: number;
}

export interface EngagementDeck extends ChannelCounts {
  deckId: string;
  title: string;
  subject: string;
  deleted: boolean;
  /** False for someone else's shared deck that this person challenged friends on. */
  own: boolean;
  createdAt: number | null;
  ownSessions: number;
}

/** What the admin's Engagement page knows about one person. */
export interface EngagementUser {
  uid: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  activeSeconds: number;
  weekSeconds: number;
  todaySeconds: number;
  lastActiveAt: number | null;
  activeMinutes: number;
  /** Days with any activity, out of the last 35. */
  activeDays: number;
  decksCreated: number;
  decksKept: number;
  sessionsCompleted: number;
  decksPracticed: number;
  linksCreated: number;
  peopleReached: number;
  completions: number;
  signups: number;
  completionRate: number | null;
  channels: Record<EngagementChannel, ChannelCounts>;
  score: number;
  points: Record<string, number>;
  /** Only when one person is asked for. */
  decks?: EngagementDeck[];
}

/** One quiz link and how far it went: a challenge, a group test, a public test or a question post. */
export interface EngagementLink {
  kind: "challenge" | "group" | "public" | "post";
  id: string;
  title: string;
  /** The group's name, for a group test. */
  label: string;
  createdAt: number | null;
  ownerUid: string;
  ownerName: string;
  ownerEmail: string;
  ownerIsAdmin: boolean;
  reached: number;
  completed: number;
  signups: number;
}

export interface ScoreRule {
  field: string;
  points: number;
  per: string;
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

/** A deck assigned to a group, or a class link: one link where each student signs in with Google. */
export interface GroupTest {
  id: string;
  deckId: string;
  deckTitle: string;
  groupId: string | null;
  /** The group's name, or the class name the owner gave a class link (may be empty). */
  groupName: string;
  kind: "group" | "class";
  /** A class link's token, for /class/TOKEN. */
  classToken?: string | null;
  /** A class link only takes Google accounts from this domain, such as a school's. Empty for any Google account. */
  allowedDomain?: string;
  /** A closed class link takes no new students. */
  open?: boolean;
  questionCount: number;
  /** 0 means no time limit. */
  timeLimitSec: number;
  /** Every question is answered by picking an option; typed-answer questions in the deck were converted or left out. */
  choicesOnly?: boolean;
  /** How many of the deck's questions a multiple choice only test left out. */
  leftOut?: number;
  createdAt: number | null;
  assigned: number;
  completed: number;
}

/** One group member's link, code and result, as the test's owner sees it. */
export interface TestTaker {
  token: string;
  email: string;
  /** The student's name from Google, for a class link. */
  name?: string;
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
  /** Seconds spent on each question, by index. Missing for tests finished before this was recorded. */
  times?: number[] | null;
  /** How many times each question was opened. */
  visits?: number[] | null;
  /** How many times each answer was changed after it was first given. */
  changes?: number[] | null;
}

export interface TestResults {
  test: GroupTest;
  questions: { prompt: string; math: string; type: string; answerDisplay: string; concept: string; figure?: Figure | null }[];
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
  questions?: { prompt: string; math: string; figure?: Figure | null; type: "numeric" | "choice"; choices: string[]; answerCount: number; pair?: boolean }[];
  result?: OwnTestResult;
}

/** What a student sees on a class link: the test, whether they're signed in with Google, then questions or their result. */
export interface OpenClassTest extends Omit<OpenTest, "email"> {
  signedIn: boolean;
  email?: string;
  name?: string;
  domain: string;
  open: boolean;
  /** Signed in, but not with a Google account this test takes, and why. */
  problem?: string;
}

export interface OwnTestResult {
  score: number;
  total: number;
  usedSec: number;
  questions: { prompt: string; math: string; figure?: Figure | null; answer: string; correct: boolean; answerDisplay: string; steps: SolutionStep[]; sec?: number | null }[];
}

/** Groups and group tests come with Pro and Pro Max. The server checks this too. */
export const canUseGroups = (a: AccountSummary | null) => !!a && (a.isAdmin || a.plan === "pro" || a.plan === "promax");
/** Same plans as groups; the server checks too. */
export const canShareDecks = canUseGroups;

/** A finished session shared as a link (/c/TOKEN) that dares friends to beat its score. */
export interface Challenge {
  token: string;
  sessionId: string;
  deckTitle: string;
  from: string;
  score: number;
  total: number;
  usedSec: number;
  timeLimitSec: number;
  /** "I got 16/20 in 7:10 on SAT Geometry. Beat me!" */
  brag: string;
  createdAt: number | null;
}

export type ChallengeOutcome = "win" | "loss" | "tie";

/** A challenge the student sent, with how each friend did. `outcome` is the friend's. */
export interface SentChallenge extends Challenge {
  friends: { name: string; status: "started" | "completed"; score: number | null; usedSec: number | null; outcome: ChallengeOutcome | null }[];
}

/** A challenge a friend played and saved to their account. */
export interface PlayedChallenge {
  token: string;
  attempt: string;
  deckTitle: string;
  from: string;
  theirScore: number;
  theirSec: number;
  score: number;
  usedSec: number;
  total: number;
  outcome: ChallengeOutcome;
  playedAt: number | null;
}

/** What a friend sees: the score to beat, then the questions (without answers), then both results. */
export interface OpenChallenge {
  title: string;
  subject?: string;
  from: string;
  score: number;
  total: number;
  usedSec: number;
  timeLimitSec: number;
  attempt?: string;
  name?: string;
  elapsedSec?: number;
  remainingSec?: number | null;
  questions?: NonNullable<OpenTest["questions"]>;
  result?: ChallengeResult;
}

export interface ChallengeResult {
  outcome: ChallengeOutcome;
  name: string;
  score: number;
  usedSec: number;
  claimed: boolean;
  /** Public id for sharing this result; older results have none. */
  share?: string | null;
  questions: (OwnTestResult["questions"][number] & { theirsCorrect: boolean })[];
}

/** One place on a public test's leaderboard. Only results whose players signed up are on it. */
export interface BoardRow {
  name: string;
  score: number;
  usedSec: number;
  /** Only in the admin's view: a made-up player. */
  sample?: boolean;
}

/** What anyone with a public test link sees: the leaderboard, then the questions (without answers), then their result. */
export interface OpenPublicTest {
  title: string;
  subject?: string;
  total: number;
  timeLimitSec: number;
  /** The top places, best first. */
  board: BoardRow[];
  /** How many people are on the leaderboard. */
  ranked: number;
  attempt?: string;
  name?: string;
  elapsedSec?: number;
  remainingSec?: number | null;
  questions?: NonNullable<OpenTest["questions"]>;
  result?: PublicTestResult;
}

export interface PublicTestResult {
  name: string;
  score: number;
  usedSec: number;
  claimed: boolean;
  /** The place this result has on the leaderboard, or would have once its player signs up. */
  rank: number;
  /** The player's own answers. The correct answers stay hidden to keep the leaderboard fair. */
  questions: { prompt: string; math: string; figure?: Figure | null; answer: string; correct: boolean; sec: number | null }[];
}

/** Admin only: a public link to a deck's test. */
export interface PublicTest {
  token: string;
  deckId: string;
  deckTitle: string;
  total: number;
  timeLimitSec: number;
  choicesOnly?: boolean;
  leftOut?: number;
  createdAt: number | null;
  plays: number;
  finished: number;
  /** The top three. */
  board: BoardRow[];
  ranked: number;
  /** Made-up players filling the board until real ones join, and how many are on it now. */
  samples: number;
  samplesShowing: number;
  /** The sample players themselves, for editing. */
  sampleList?: { name: string; score: number; usedSec: number }[];
  /** An inviting line for social posts, with the current leader. */
  shareText: string;
}

export interface PublicPlayer {
  attempt: string;
  name: string;
  status: "started" | "completed";
  score: number | null;
  usedSec: number | null;
  registered: boolean;
  completedAt: number | null;
  /** A made-up player, and whether it's still on the board or a real player has taken its place. */
  sample?: boolean;
  showing?: boolean;
}

/** One question as a question post's visitor sees it: everything to answer it, nothing that gives it away. */
export interface PostQuestion {
  /** Its place in the deck. */
  index: number;
  prompt: string;
  math: string;
  figure?: Figure | null;
  type: "numeric" | "choice";
  choices: string[];
  answerCount: number;
  pair: boolean;
  concept: string;
  difficulty: string;
}

/** A social media post of one question from a deck, as the admin sees it. */
export interface QuestionPost {
  token: string;
  deckId: string;
  deckTitle: string;
  subject?: string;
  /** The posted question's place in the deck. */
  featured: number;
  question: PostQuestion;
  total: number;
  views: number;
  /** Answers to the posted question, and how many were right. */
  answers: number;
  right: number;
  /** Answers to the deck's other questions, from visitors who kept going. */
  more: number;
  /** Visitors who saved the deck to their account. */
  saved: number;
  createdAt: number | null;
  shareText: string;
}

/** A question post as a visitor opens it: the posted question first, then the rest of the deck. */
export interface OpenQuestionPost {
  title: string;
  subject?: string;
  level: string;
  total: number;
  questions: PostQuestion[];
}

export interface PostAnswer {
  correct: boolean;
  answer: string;
  steps: SolutionStep[];
  /** The percent who got the posted question right, once enough people have answered it. */
  rightRate: number | null;
}
