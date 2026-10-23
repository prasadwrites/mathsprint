import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

/** Every deck has a subject. Decks made before subjects existed have none, and count as Math. */
export const DEFAULT_SUBJECT = "Math";
/** The list until the admin first saves one; matches functions/subjects.py. */
export const STARTER_SUBJECTS = ["Math", "Physics", "Chemistry", "Biology", "General Knowledge"];
export const MAX_SUBJECTS = 40;
const MAX_NAME = 40;

export const cleanSubject = (name: unknown) => String(name ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_NAME);

export const isMath = (subject: string) => ["math", "maths", "mathematics"].includes(cleanSubject(subject).toLowerCase());

export const subjectOf = (d: { subject?: string } | null | undefined) => cleanSubject(d?.subject) || DEFAULT_SUBJECT;

/** "solve" for a math question, "answer" for any other. */
export const solveVerb = (subject: string) => (isMath(subject) ? "solve" : "answer");

/** No blanks or repeats (ignoring case), Math always first. */
export function cleanSubjects(names: unknown): string[] {
  const out = [DEFAULT_SUBJECT];
  for (const n of Array.isArray(names) ? names : []) {
    const name = cleanSubject(n);
    if (name && !isMath(name) && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, MAX_SUBJECTS);
}

const ref = () => doc(db, "settings", "subjects");

export async function listSubjects(): Promise<string[]> {
  try {
    const snap = await getDoc(ref());
    return cleanSubjects(snap.exists() ? snap.data().names : STARTER_SUBJECTS);
  } catch {
    return cleanSubjects(STARTER_SUBJECTS);
  }
}

/** Admin only (firestore.rules). Returns the list as saved. */
export async function saveSubjects(names: string[]): Promise<string[]> {
  const clean = cleanSubjects(names);
  await setDoc(ref(), { names: clean });
  return clean;
}

/** The subjects to filter a deck list by: the admin's list, then any a deck has that's since been taken off it. */
export function filterSubjects(listed: string[], decks: { subject?: string }[]): string[] {
  const extra = decks.map(subjectOf).filter((s) => !listed.some((l) => l.toLowerCase() === s.toLowerCase()));
  return [...listed, ...new Set(extra)];
}

export const sameSubject = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
