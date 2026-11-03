import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { recordActivity } from "./db";
import { auth } from "./firebase";

const BEAT_MS = 60_000;
/** Someone who hasn't touched the page for this long has probably walked away. */
const IDLE_MS = 5 * 60_000;
const INPUTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;

/** Counts the minutes a signed-in person spends actively using the site, for the admin's Accounts and Engagement
 * pages. It runs on every page, including the link pages (class links, group tests, challenges, public tests, question
 * posts and plans), so a student who only ever takes tests from a link still gets their time counted. */
export function useActivityHeartbeat() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => onAuthStateChanged(auth, (u) => setSignedIn(!!u)), []);
  useEffect(() => {
    if (!signedIn) return;
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
    };
    INPUTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInput < IDLE_MS) {
        recordActivity().catch(() => {}); // a missed minute isn't worth bothering anyone about
      }
    }, BEAT_MS);
    return () => {
      window.clearInterval(timer);
      INPUTS.forEach((e) => window.removeEventListener(e, onInput));
    };
  }, [signedIn]);
}
