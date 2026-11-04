import type { Mode } from "./types";
import type { Selection } from "./insights";

/** A public deck's practice set up before signing in (on the sign-in page's deck list). Once the visitor has signed
 * in or signed up, the same page starts that practice for them. */
export interface PendingStart {
  deckId: string;
  mode: Mode;
  n: number;
  minutes: number;
  selection: Selection;
}

const KEY = "ms.publicDeck.start";

export function holdPublicStart(start: PendingStart) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...start, at: Date.now() }));
  } catch {
    // Storage blocked: after signing in, the visitor sets the practice up again.
  }
}

/** The practice held for this deck, once: reading it clears it. Older than a day is dropped. */
export function takePublicStart(deckId: string): PendingStart | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const held = JSON.parse(raw) as PendingStart & { at?: number };
    if (held.deckId !== deckId) return null;
    localStorage.removeItem(KEY);
    return Date.now() - (held.at ?? 0) < 86_400_000 ? held : null;
  } catch {
    return null;
  }
}

/** The deck's practice setup page, which works signed out for public decks. */
export const publicDeckPath = (deckId: string) => `/decks/${deckId}/practice`;
