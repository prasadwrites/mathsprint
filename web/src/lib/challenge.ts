/** A friend plays a challenge at /c/TOKEN without an account. Signing up afterwards saves their result. */
const KEY = "ms.challenge.claim";

export const challengeLink = (token: string) => `${window.location.origin}/c/${token}`;

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
