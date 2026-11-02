/** Offer codes from the /join?code=CODE links the admin emails out. */
const KEY = "ms.offer";

export const offerLink = (code: string) => `https://mathsprint.org/join?code=${encodeURIComponent(code)}`;

export const cleanCode = (code: string) => code.replace(/\s+/g, "").toUpperCase();

/** The code in the address bar, if any. */
export const codeFromUrl = () => cleanCode(new URLSearchParams(window.location.search).get("code") ?? "");

/** Keeps the code through the sign-up step, so it's redeemed as soon as the new account exists. */
export function holdOfferCode(code: string) {
  try {
    localStorage.setItem(KEY, cleanCode(code));
  } catch {
    // Storage blocked: they can redeem it on the /join page once signed in.
  }
}

export function pendingOfferCode(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearOfferCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** Nov 30, 2026, in US Eastern time, the zone offer codes end in. */
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
