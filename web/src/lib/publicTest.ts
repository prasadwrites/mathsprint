/** Public test links (/p/TOKEN): anyone plays without an account; signing up afterwards puts the result on the leaderboard. */
const CLAIM = "ms.public.claim";

export const publicTestLink = (token: string) => `${window.location.origin}/p/${token}`;

/** The leaderboard card picture (add size=story for the tall one). Served by the public_test_page function. */
export const publicTestCard = (token: string) => `/p/${token}/card.png`;

/** The player's answers until they finish. */
export const publicStoreKey = (token: string) => `ms.public.${token}`;
/** The player's attempt, kept after they finish so coming back shows their result and place. */
export const publicAttemptKey = (token: string) => `ms.public.${token}.attempt`;

export interface PendingPublicClaim {
  token: string;
  attempt: string;
  title: string;
}

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
    // Storage blocked: the player just can't come back to their result or claim it after signing up.
  }
}

export const savedAttempt = (token: string) => read<string>(publicAttemptKey(token));
export const saveAttempt = (token: string, attempt: string) => write(publicAttemptKey(token), attempt);

/** Remembers a finished, unclaimed result so it goes on the leaderboard once the player has signed in. */
export const rememberPublicClaim = (claim: PendingPublicClaim) => write(CLAIM, claim);
export const pendingPublicClaim = () => read<PendingPublicClaim>(CLAIM);
export const clearPublicClaim = () => write(CLAIM, null);
