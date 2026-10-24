/** Campaign links like https://mathsprint.org/?ref=tutors-oct tag the account made from them, for the admin. */
const KEY = "ms.ref";

/** Keeps the first ?ref= tag seen so it survives the sign-up step. */
export function captureRef() {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref) return;
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, ref.slice(0, 40));
  } catch {
    // Storage blocked: the account just won't be tagged.
  }
}

export function pendingRef(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearRef() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
