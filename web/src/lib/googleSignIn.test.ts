import { describe, expect, it } from "vitest";
import { googleSignInProblem } from "./googleSignIn";

describe("googleSignInProblem", () => {
  it("stays quiet when a second click replaces the window", () => {
    expect(googleSignInProblem("auth/cancelled-popup-request", "login")).toBeNull();
  });

  it("points a closed window at the school's settings, not MathSprint", () => {
    const p = googleSignInProblem("auth/popup-closed-by-user", "login")!;
    expect(p.tone).toBe("notice");
    expect(p.text).toContain("not a problem with MathSprint");
    expect(p.text).toContain("sign up with your email");
  });

  it("sends class-link students to their teacher, since class tests need Google", () => {
    const p = googleSignInProblem("auth/popup-closed-by-user", "class")!;
    expect(p.text).toContain("Ask your teacher");
    expect(p.text).not.toContain("email below");
  });

  it("explains blocked pop-ups and unknown errors", () => {
    expect(googleSignInProblem("auth/popup-blocked", "login")!.text).toContain("Allow pop-ups");
    const p = googleSignInProblem("auth/internal-error", "class")!;
    expect(p.tone).toBe("error");
    expect(p.text).toContain("not from MathSprint");
  });
});
