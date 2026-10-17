/** Invite links look like https://mathsprint.org/?invite=TOKEN&email=friend@example.com. */
const KEY = "ms.invite";

export interface PendingInvite {
  token: string;
  email: string;
}

/** Keeps an invite from the address bar so it survives the sign-up step. */
export function captureInvite() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (!token) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, email: params.get("email") ?? "" }));
  } catch {
    // Storage blocked: the invite still counts when they sign up with the invited email.
  }
}

export function pendingInvite(): PendingInvite | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingInvite) : null;
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

export const inviteLink = (token: string, email: string) =>
  `${window.location.origin}/?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
