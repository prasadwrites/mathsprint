import type { TestTaker } from "./types";

/** The page a group member opens. They need their access code too. */
export const testLink = (token: string) => `${window.location.origin}/t/${token}`;

export const shareText = (title: string, t: Pick<TestTaker, "token" | "code">) =>
  `Your MathSprint test "${title}"\nLink: ${testLink(t.token)}\nAccess code: ${t.code}`;

export const testMailto = (title: string, t: Pick<TestTaker, "token" | "code" | "email">) =>
  `mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent(`MathSprint test: ${title}`)}&body=${encodeURIComponent(
    `${shareText(title, t)}\n\nOpen the link, enter the access code, and the test starts. You'll see your result at the end.`,
  )}`;
