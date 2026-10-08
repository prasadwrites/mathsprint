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
import type { ConceptStat, Deck, Difficulty, EndReason, Mode, PracticeSession, Question } from "./types";
import { isCorrect } from "./grading";
import { SAMPLE_DECK } from "./sampleDeck";

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
}

export async function generateDeck(input: GenerateInput) {
  const call = httpsCallable<GenerateInput, { deckId: string; questionCount: number; dropped: number }>(
    functions,
    "generate_deck",
    { timeout: 540_000 },
  );
  return (await call(input)).data;
}

export async function explainStep(args: { deckId: string; questionId: string; step: number | null; style: string }) {
  const call = httpsCallable<typeof args, { explanation: string }>(functions, "explain_step");
  return (await call(args)).data.explanation;
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
    timings: { 0: { startedAt: 0 } },
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

/** Records the moment a question was submitted and the next one started. */
export function advance(sessionId: string, index: number, atMs: number) {
  return updateDoc(doc(db, "sessions", sessionId), {
    [`timings.${index}.answeredAt`]: atMs,
    [`timings.${index + 1}`]: { startedAt: atMs },
    currentIndex: index + 1,
  });
}

export async function finishSession(s: PracticeSession, questions: Question[], reason: EndReason, usedSec: number) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const results: Record<string, boolean> = {};
  s.questionIds.forEach((qid, i) => {
    const q = byId.get(qid);
    results[i] = q ? isCorrect(q, s.answers[i]) : false;
  });
  const score = Object.values(results).filter(Boolean).length;
  const timings = { ...s.timings };
  if (timings[s.currentIndex] && timings[s.currentIndex].answeredAt == null) {
    timings[s.currentIndex] = { ...timings[s.currentIndex], answeredAt: Math.round(usedSec * 1000) };
  }
  // Per-concept totals for the questions the student reached, used for weak-topic suggestions.
  const conceptStats: Record<string, ConceptStat> = {};
  s.questionIds.forEach((qid, i) => {
    const q = byId.get(qid);
    const t = timings[i];
    if (!q || i > s.currentIndex || !t) return;
    const c = (conceptStats[q.concept] ??= { attempted: 0, correct: 0, seconds: 0 });
    c.attempted += 1;
    c.correct += results[i] ? 1 : 0;
    c.seconds += Math.max(0, ((t.answeredAt ?? usedSec * 1000) - t.startedAt) / 1000);
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
