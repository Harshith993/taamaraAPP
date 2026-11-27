"use client";

import { useEffect } from "react";

const HOLD_MS = 1500;
const HOLD_REDUCED_MS = 450;
const OUT_MS = 820;

/** Plays the intro's ending: the logo flies to the page's brand mark and the overlay clears. */
export function IntroController() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("tt-intro")) return;
    const overlay = document.getElementById("tt-intro");
    const badge = overlay?.querySelector<HTMLElement>(".tt-intro-badge");
    if (!overlay || !badge) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let done = false;
    let timer = 0;

    const finish = () => {
      root.classList.remove("tt-intro", "tt-intro-out");
      window.setTimeout(() => root.classList.remove("tt-intro-reveal"), 700);
    };

    const leave = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      // The page settles in under the clearing overlay while the logo flies, never after it.
      root.classList.add("tt-intro-out", "tt-intro-reveal");
      // The first brand mark that is on screen (header, portal bar, sign-in page).
      const target = [...document.querySelectorAll<HTMLElement>("[data-brand-mark]")].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      });
      if (reduced || !target || typeof badge.animate !== "function") {
        overlay.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 250 : 420, easing: "ease-out", fill: "forwards" });
        window.setTimeout(finish, reduced ? 250 : 420);
        return;
      }
      const from = badge.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const scale = to.width / from.width;
      badge.animate(
        [
          { transform: "translate(0, 0) scale(1)", boxShadow: "0 30px 80px -30px rgb(22 20 31 / 0.35)" },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, boxShadow: "0 10px 30px -14px rgb(22 20 31 / 0.16)" },
        ],
        { duration: OUT_MS, easing: "cubic-bezier(0.65, 0, 0.25, 1)", fill: "forwards" },
      );
      overlay.animate([{ backgroundColor: "rgb(255 255 255 / 1)" }, { backgroundColor: "rgb(255 255 255 / 0)" }], { duration: OUT_MS * 0.8, delay: OUT_MS * 0.2, easing: "ease-out", fill: "forwards" });
      window.setTimeout(finish, OUT_MS);
    };

    // The <head> script listens for the first tap or key (even before this code loaded).
    if ((window as { __ttSkip?: number }).__ttSkip) {
      leave();
      return;
    }
    timer = window.setTimeout(leave, reduced ? HOLD_REDUCED_MS : HOLD_MS);
    window.addEventListener("tt-intro-skip", leave, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("tt-intro-skip", leave);
    };
  }, []);
  return null;
}
