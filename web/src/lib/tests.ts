import type { TestTaker } from "./types";

/** The page a group member opens. They need their access code too. */
export const testLink = (token: string) => `${window.location.origin}/t/${token}`;

export const shareText = (title: string, t: Pick<TestTaker, "token" | "code">) =>
  `Your MathSprint test "${title}"\nLink: ${testLink(t.token)}\nAccess code: ${t.code}`;

export const testMailto = (title: string, t: Pick<TestTaker, "token" | "code" | "email">) =>
  `mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent(`MathSprint test: ${title}`)}&body=${encodeURIComponent(
    `${shareText(title, t)}\n\nOpen the link, enter the access code, and the test starts. You'll see your result at the end.`,
  )}`;

/** A class link: one link for everyone, and each student signs in with Google to take it. */
export const classLink = (token: string) => `${window.location.origin}/class/${token}`;

export const classShareText = (title: string, token: string, domain = "") =>
  `MathSprint test: ${title}\n${classLink(token)}\nSign in with your ${domain ? `@${domain} ` : ""}Google account (your school account) to start. You get one try.`;

/** How a class link student shows up in the owner's lists: their Google name, or their email. */
export const takerLabel = (t: Pick<TestTaker, "name" | "email">) => t.name || t.email;
