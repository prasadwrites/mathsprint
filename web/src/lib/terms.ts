/** The Terms of Use at /terms. Keep in step with TERMS_VERSION in functions/offers.py: changing it asks everyone to
 * agree again on their next visit. */
export const TERMS_VERSION = "2026-11-02";

const KEY = "ms.terms";

/** Remembers that the person ticked "I agree" on the sign-up form, so the new account records it. */
export function agreeTermsOnSignup() {
  try {
    localStorage.setItem(KEY, TERMS_VERSION);
  } catch {
    // Storage blocked: they'll be asked once more after signing in.
  }
}

export function pendingTerms(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearTerms() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
