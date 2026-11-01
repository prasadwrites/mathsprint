/** Friendly words for a failed or abandoned Google sign-in.
 *
 * Many school Google Workspace accounts block apps their IT team hasn't approved. Google then shows its own
 * "Access blocked: Your institution's admin needs to review…" page inside the sign-in window, and all MathSprint
 * ever sees is the window closing. So a closed window gets a gentle note that names the school setting, and
 * every other failure says plainly whether it's the browser, the network or the school, not MathSprint. */

export type GoogleSignInWhere = "login" | "class";

export interface GoogleSignInProblem {
  /** "notice" for a closed window (maybe on purpose), "error" for a real failure. */
  tone: "notice" | "error";
  title: string;
  text: string;
}

const schoolNext: Record<GoogleSignInWhere, string> = {
  login: "Try a personal Google account, or sign up with your email below. You can also ask your school's IT team to approve MathSprint.",
  class: "Ask your teacher to have your school's IT team approve MathSprint (mathsprint.org) for student Google accounts, or try a personal Google account if your teacher allows it.",
};

export function googleSignInProblem(code: string, where: GoogleSignInWhere): GoogleSignInProblem | null {
  if (code.includes("cancelled-popup-request")) return null; // a second click replaced the first window; nothing went wrong
  if (code.includes("popup-closed")) {
    return {
      tone: "notice",
      title: "Google sign-in was closed before it finished.",
      text: `If Google said "Access blocked" or "Your institution's admin needs to review" the app, that's your school's Google settings blocking outside apps, not a problem with MathSprint. ${schoolNext[where]}`,
    };
  }
  if (code.includes("popup-blocked")) {
    return {
      tone: "error",
      title: "Your browser blocked the Google sign-in window.",
      text: "Allow pop-ups for mathsprint.org in your browser, then press the Google button again.",
    };
  }
  if (code.includes("user-disabled")) {
    return {
      tone: "error",
      title: "This account has been suspended.",
      text: where === "login" ? "Contact the person who runs MathSprint." : "Ask your teacher for help.",
    };
  }
  if (code.includes("network-request-failed")) {
    return {
      tone: "error",
      title: "Google sign-in couldn't connect.",
      text: `Your network may be blocking Google sign-in (school Wi-Fi often does). Try again, or use another network. ${schoolNext[where]}`,
    };
  }
  if (code.includes("account-exists-with-different-credential")) {
    return {
      tone: "error",
      title: "This email already has a MathSprint account with a password.",
      text: where === "login" ? "Sign in with your email and password below instead." : "Use a different Google account, or ask your teacher for help.",
    };
  }
  return {
    tone: "error",
    title: "Google sign-in didn't finish.",
    text: `This usually comes from your school's Google settings or network blocking outside apps, not from MathSprint. ${schoolNext[where]}`,
  };
}
