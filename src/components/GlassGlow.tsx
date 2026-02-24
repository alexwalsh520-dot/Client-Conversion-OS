"use client";

import { useEffect } from "react";

/**
 * Attaches a mousemove listener to every `.glass` element so the
 * radial-gradient glow (defined in CSS via --mouse-x / --mouse-y)
 * tracks the cursor position in real time.
 */
export default function GlassGlow() {
  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const target = (e.currentTarget as HTMLElement);
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      target.style.setProperty("--mouse-x", `${x}px`);
      target.style.setProperty("--mouse-y", `${y}px`);
    }

    function attach() {
      document.querySelectorAll<HTMLElement>(".glass").forEach((el) => {
        el.removeEventListener("mousemove", handleMove as EventListener);
        el.addEventListener("mousemove", handleMove as EventListener);
      });
    }

    // Attach on mount and re-attach whenever DOM changes (page navigation)
    attach();
    const observer = new MutationObserver(() => {
      requestAnimationFrame(attach);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>(".glass").forEach((el) => {
        el.removeEventListener("mousemove", handleMove as EventListener);
      });
    };
  }, []);

  return null;
}
