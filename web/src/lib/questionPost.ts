/** Question posts (/q/TOKEN): one question from a deck, shared on social media. Anyone answers it without an account;
 * signing up saves the whole deck to their account. */
import type { PostAnswer } from "./types";

const SAVE = "ms.post.save";

export const questionPostLink = (token: string) => `${window.location.origin}/q/${token}`;

/** The question card picture (add size=story for the tall one). Served by the question_post_page function. */
export const questionPostCard = (token: string) => `/q/${token}/card.png`;

/** What the visitor has answered on this post so far, so a reload keeps their place. */
export interface PostProgress {
  answers: Record<number, string>;
  results: Record<number, PostAnswer>;
}

const progressKey = (token: string) => `ms.post.${token}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: a reload starts the visitor over, and signing up doesn't save the deck by itself.
  }
}

export const loadProgress = (token: string) => read<PostProgress>(progressKey(token));
export const saveProgress = (token: string, p: PostProgress) => write(progressKey(token), p);

/** Remembers to save this post's deck once the visitor has signed up or signed in. */
export const rememberPostSave = (token: string) => write(SAVE, { token });
export const pendingPostSave = () => read<{ token: string }>(SAVE);
export const clearPostSave = () => write(SAVE, null);
