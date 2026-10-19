import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { AccountSummary, AdminAccount, Group, ProblemReport, PromotionOffer, GroupTest, Invite, OpenTest, TestResults, TestTaker, UpgradeRequest, ConceptStat, Deck, Difficulty, EndReason, Mode, PlanId, PlanLimits, PracticeSession, Question } from "./types";
import { isCorrect } from "./grading";
import { SAMPLE_DECK } from "./sampleDeck";
import { moveTo, opened, secondsOn } from "./timing";

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);

export async function listDecks(uid: string): Promise<Deck[]> {
  const snap = await getDocs(query(collection(db, "decks"), where("ownerId", "==", uid), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toDate(d.data().createdAt) }) as Deck);
}

export async function getDeck(deckId: string): Promise<Deck | null> {
  const d = await getDoc(doc(db, "decks", deckId));
  return d.exists() ? ({ id: d.id, ...d.data(), createdAt: toDate(d.data().createdAt) } as Deck) : null;
}

export async function getQuestions(deckId: string): Promise<Question[]> {
  const snap = await getDocs(query(collection(db, "decks", deckId, "questions"), orderBy("order")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Question);
}

export interface GenerateInput {
  topic: string;
  count: number;
  difficulty: Difficulty;
  level: string;
  notes: string;
  accessCode: string;
}

export async function generateDeck(input: GenerateInput) {
  const call = httpsCallable<GenerateInput, { deckId: string; questionCount: number; dropped: number }>(
    functions,
    "generate_deck",
    // Pro Max decks of 200 questions are written in parts and can take several minutes.
    { timeout: 1_800_000 },
  );
  return (await call(input)).data;
}

export async function explainStep(args: { deckId: string; questionId: string; step: number | null; style: string }) {
  const call = httpsCallable<typeof args, { explanation: string }>(functions, "explain_step");
  return (await call(args)).data.explanation;
}

/** `invite` is the token from an invite link, so a brand new account credits the friend who invited it. */
export async function getAccount(invite?: string) {
  return (await httpsCallable<{ invite?: string }, AccountSummary>(functions, "get_account")(invite ? { invite } : {})).data;
}

export async function createInvite(email: string) {
  return (await httpsCallable<{ email: string }, Invite>(functions, "create_invite")({ email })).data;
}

export async function listInvites() {
  return (await httpsCallable<void, { invites: Invite[] }>(functions, "list_invites")()).data.invites;
}

export async function listGroups() {
  return (await httpsCallable<void, { groups: Group[] }>(functions, "list_groups")()).data.groups;
}

/** Creates a group (no id) or replaces a group's name and emails. */
export async function saveGroup(group: { id?: string; name: string; emails: string[] }) {
  return (await httpsCallable<typeof group, Group>(functions, "save_group")(group)).data;
}

export async function deleteGroup(id: string) {
  await httpsCallable<{ id: string }, { ok: boolean }>(functions, "delete_group")({ id });
}

/** Gives every member of the group their own link and code. Assigning again adds anyone new to the group. */
export async function assignTest(args: { deckId: string; groupId: string; timeLimitSec: number }) {
  return (await httpsCallable<typeof args, { id: string; added: number }>(functions, "assign_test", { timeout: 120_000 })(args)).data;
}

export async function listTests(deckId?: string) {
  return (await httpsCallable<{ deckId?: string }, { tests: GroupTest[] }>(functions, "list_tests")(deckId ? { deckId } : {})).data.tests;
}

export async function getTestResults(id: string) {
  return (await httpsCallable<{ id: string }, TestResults>(functions, "get_test_results")({ id })).data;
}

export async function resetTestLink(token: string) {
  return (await httpsCallable<{ token: string }, TestTaker>(functions, "reset_test_link")({ token })).data;
}

export async function deleteTest(id: string) {
  await httpsCallable<{ id: string }, { ok: boolean }>(functions, "delete_test", { timeout: 120_000 })({ id });
}

/** Group members don't sign in. Without a code this only says what the test is; with the right code it starts the clock. */
export async function openTest(token: string, code?: string) {
  return (await httpsCallable<{ token: string; code?: string }, OpenTest>(functions, "open_test")(code === undefined ? { token } : { token, code })).data;
}

export async function submitTest(token: string, code: string, answers: Record<string, string>, track: { times: number[]; visits: number[]; changes: number[] }) {
  return (await httpsCallable<object, OpenTest>(functions, "submit_test")({ token, code, answers, ...track })).data;
}

export async function reportProblem(message: string, page: string) {
  return (await httpsCallable<{ message: string; page: string }, ProblemReport>(functions, "report_problem")({ message, page })).data;
}

/** Users get their own reports (markRead clears the reply notification); the admin gets all of them. */
export async function listReports(markRead = false) {
  return (await httpsCallable<{ markRead: boolean }, { reports: ProblemReport[] }>(functions, "list_reports")({ markRead })).data.reports;
}

export async function replyReport(id: string, text: string) {
  await httpsCallable<{ id: string; text: string }, { ok: boolean }>(functions, "reply_report")({ id, text });
}

export async function adminReplyReport(args: { id: string; text: string; resolve: boolean }) {
  await httpsCallable<typeof args, { ok: boolean }>(functions, "admin_reply_report")(args);
}

export async function adminOfferPromotion(args: { uid: string; plan: PlanId; months: number; note: string }) {
  return (await httpsCallable<typeof args, PromotionOffer>(functions, "admin_offer_promotion")(args)).data;
}

/** Withdraws an unanswered offer and ends a running promotion now. */
export async function adminEndPromotion(uid: string) {
  await httpsCallable<{ uid: string }, { ok: boolean }>(functions, "admin_end_promotion")({ uid });
}

export async function respondPromotion(id: string, accept: boolean) {
  return (await httpsCallable<{ id: string; accept: boolean }, { accepted: boolean; endsAt?: number }>(functions, "respond_promotion")({ id, accept })).data;
}

/** One heartbeat for a minute of active use. The server ignores extra beats inside the same minute. */
export async function recordActivity() {
  await httpsCallable<void, { counted: boolean }>(functions, "record_activity")();
}

export async function adminListAccounts() {
  return (await httpsCallable<void, { accounts: AdminAccount[]; plans: Record<PlanId, PlanLimits> }>(functions, "admin_list_accounts")()).data;
}

/** accessCode: a code to set, "generate" for a random one, or null to go back to the shared code. */
export interface AccountUpdate {
  uid: string;
  plan?: PlanId;
  status?: "active" | "suspended";
  accessCode?: string | null;
  resetDecks?: boolean;
}

export async function adminUpdateAccount(update: AccountUpdate) {
  await httpsCallable<AccountUpdate, { ok: boolean }>(functions, "admin_update_account")(update);
}

/** Permanently deletes an account's sign-in, decks, practice history and settings. */
export async function adminDeleteAccount(uid: string) {
  return (await httpsCallable<{ uid: string }, { ok: boolean; decks: number; sessions: number }>(functions, "admin_delete_account", { timeout: 300_000 })({ uid })).data;
}

export async function requestUpgrade(plan: PlanId, message: string) {
  await httpsCallable<{ plan: PlanId; message: string }, { id: string }>(functions, "request_upgrade")({ plan, message });
}

/** Students get their own requests (markRead clears the reply notification); the admin gets all of them. */
export async function listUpgradeRequests(markRead = false) {
  return (await httpsCallable<{ markRead: boolean }, { requests: UpgradeRequest[] }>(functions, "list_upgrade_requests")({ markRead })).data.requests;
}

export async function adminReplyUpgrade(args: { id: string; reply: string; approve: boolean }) {
  await httpsCallable<typeof args, { ok: boolean }>(functions, "admin_reply_upgrade")(args);
}

/** A student writes back on one of their requests. */
export async function replyUpgrade(id: string, text: string) {
  await httpsCallable<{ id: string; text: string }, { ok: boolean }>(functions, "reply_upgrade")({ id, text });
}

/** Deletes the deck with its questions and practice history. It still counts toward the plan's decks. */
export async function deleteDeck(deckId: string) {
  return (await httpsCallable<{ deckId: string }, { ok: boolean; sessions: number }>(functions, "delete_deck", { timeout: 120_000 })({ deckId })).data;
}

/** Adds a ready-made deck so a new student can try practice before generating their own. */
export async function addSampleDeck(uid: string): Promise<string> {
  const deckRef = doc(collection(db, "decks"));
  const batch = writeBatch(db);
  const { questions, ...meta } = SAMPLE_DECK;
  batch.set(deckRef, { ...meta, ownerId: uid, questionCount: questions.length, source: "sample", createdAt: serverTimestamp() });
  questions.forEach((q, i) => batch.set(doc(collection(deckRef, "questions")), { ...q, order: i, verified: true }));
  await batch.commit();
  return deckRef.id;
}

export async function startSession(opts: {
  uid: string;
  deck: Deck;
  mode: Mode;
  questionIds: string[];
  timeLimitSec: number;
}): Promise<string> {
  const ref = await addDoc(collection(db, "sessions"), {
    ownerId: opts.uid,
    deckId: opts.deck.id,
    deckTitle: opts.deck.title,
    mode: opts.mode,
    questionIds: opts.questionIds,
    timeLimitSec: opts.timeLimitSec,
    startedAtMs: Date.now(),
    startedAt: serverTimestamp(),
    currentIndex: 0,
    answers: {},
    timings: { 0: { startedAt: 0, spentMs: 0 } },
    visitStartedAt: 0,
    status: "active",
  });
  return ref.id;
}

export async function getSession(id: string): Promise<PracticeSession | null> {
  const d = await getDoc(doc(db, "sessions", id));
  return d.exists() ? ({ id: d.id, ...d.data() } as PracticeSession) : null;
}

export async function listSessions(uid: string, deckId?: string): Promise<PracticeSession[]> {
  const snap = await getDocs(query(collection(db, "sessions"), where("ownerId", "==", uid), where("status", "==", "completed")));
  const all = snap.docs.map((d) => ({ mode: "practice", ...d.data(), id: d.id }) as PracticeSession);
  return deckId ? all.filter((s) => s.deckId === deckId) : all;
}

export function saveAnswer(sessionId: string, index: number, answer: string) {
  return updateDoc(doc(db, "sessions", sessionId), { [`answers.${index}`]: answer });
}

/** Saves a move between questions (forwards, backwards or a jump). */
export function saveNavigation(sessionId: string, nav: Pick<PracticeSession, "timings" | "currentIndex" | "visitStartedAt">) {
  return updateDoc(doc(db, "sessions", sessionId), { ...nav });
}

export async function finishSession(s: PracticeSession, questions: Question[], reason: EndReason, usedSec: number) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const results: Record<string, boolean> = {};
  s.questionIds.forEach((qid, i) => {
    const q = byId.get(qid);
    results[i] = q ? isCorrect(q, s.answers[i]) : false;
  });
  const score = Object.values(results).filter(Boolean).length;
  // Close the visit in progress so every question's time is final.
  const closed = { ...s, ...moveTo(s, s.currentIndex, Math.round(usedSec * 1000)), status: "completed" as const };
  const { timings } = closed;
  // Per-concept totals for the questions the student opened, used for weak-topic suggestions.
  const conceptStats: Record<string, ConceptStat> = {};
  s.questionIds.forEach((qid, i) => {
    const q = byId.get(qid);
    if (!q || !opened(closed, i)) return;
    const c = (conceptStats[q.concept] ??= { attempted: 0, correct: 0, seconds: 0 });
    c.attempted += 1;
    c.correct += results[i] ? 1 : 0;
    c.seconds += secondsOn(closed, i, 0) ?? 0;
  });
  await updateDoc(doc(db, "sessions", s.id), {
    status: "completed",
    endReason: reason,
    usedSec,
    score,
    accuracy: score / s.questionIds.length,
    results,
    conceptStats,
    timings,
    answers: s.answers,
    completedAt: serverTimestamp(),
  });
}
