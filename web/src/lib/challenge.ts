/** A friend plays a challenge at /c/TOKEN without an account. Signing up afterwards saves their result. */
const KEY = "ms.challenge.claim";

/** `share` is a friend's result to show in the link's preview instead of the challenge. */
export const challengeLink = (token: string, share?: string) => `${window.location.origin}/c/${token}${share ? `?r=${share}` : ""}`;

/** The score card picture (add size=story for the tall one). Served by the challenge_page function. */
export const challengeCard = (token: string, share?: string) => `/c/${token}/card.png${share ? `?r=${share}` : ""}`;

/** Where the friend's answers and attempt live on their device until they finish. */
export const challengeStoreKey = (token: string) => `ms.challenge.${token}`;

export interface PendingClaim {
  token: string;
  attempt: string;
}

/** Remembers a finished attempt so it can be saved once the friend has signed in. */
export function rememberClaim(claim: PendingClaim) {
  try {
    localStorage.setItem(KEY, JSON.stringify(claim));
  } catch {
    // Storage blocked: the result just isn't saved to the new account.
  }
}

export function pendingClaim(): PendingClaim | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingClaim) : null;
  } catch {
    return null;
  }
}

export function clearClaim() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
