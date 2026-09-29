"use client";

import { useEffect } from "react";

/**
 * Sections ease up into place the first time they scroll into view (SEC-25).
 *
 * Mark an element with `data-reveal` to have it rise as one piece, or with
 * `data-reveal-stagger` to have its children follow one another. Only elements
 * still below the fold are hidden, and only once this has run, so the page
 * reads fine without JavaScript and nothing on screen ever blinks out. The
 * look lives in globals.css; reduced motion skips it entirely.
 */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal], [data-reveal-stagger]")].filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight * 0.92,
    );
    for (const el of targets) {
      el.dataset.state = "pending";
      if (el.hasAttribute("data-reveal-stagger")) {
        [...el.children].forEach((child, i) => (child as HTMLElement).style.setProperty("--i", String(i)));
      }
    }

    // A scroll check rather than an IntersectionObserver: a fast fling, the
    // End key or an anchor jump can carry a section from below the screen to
    // above it between two frames, and an observer never reports that, which
    // would leave the section invisible. Anything at or above the line shows.
    // Eleven rects per scroll event is cheap, so no frame throttle.
    let pending = targets;
    const check = () => {
      const line = window.innerHeight * 0.88;
      pending = pending.filter((el) => {
        if (el.getBoundingClientRect().top >= line) return true;
        el.dataset.state = "shown";
        return false;
      });
      if (pending.length === 0) stop();
    };
    const stop = () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return stop;
  }, []);

  return null;
}
