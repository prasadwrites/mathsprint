import { useEffect } from "react";
import { recordActivity } from "./db";

const BEAT_MS = 60_000;
/** Someone who hasn't touched the page for this long has probably walked away. */
const IDLE_MS = 5 * 60_000;
const INPUTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;

/** Counts the minutes this person spends actively using the app, for the admin's Accounts page. */
export function useActivityHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
}
