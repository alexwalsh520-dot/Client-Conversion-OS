"use client";

/**
 * V3 · Ask Ahmad shell.
 *
 * Wraps every V3 page. Listens for the `ccos-v3-ask` window event
 * (fired by the outer app sidebar's "Ask Ahmad" button when the user
 * is inside /coaching-v3/*) and toggles the AskPanel drawer.
 */

import { useCallback, useEffect, useState } from "react";
import AskPanel from "./AskPanel";

export const V3_ASK_EVENT = "ccos-v3-ask";

export default function AskShell({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<{ open: boolean; about: string | null }>({
    open: false,
    about: null,
  });

  const openAsk = useCallback((about?: string | null) => {
    setAsk({ open: true, about: about ?? null });
  }, []);
  const closeAsk = useCallback(() => {
    setAsk((a) => ({ ...a, open: false }));
  }, []);

  useEffect(() => {
    const onAsk = (e: Event) =>
      openAsk((e as CustomEvent<{ about?: string }>).detail?.about ?? null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAsk();
    };
    window.addEventListener(V3_ASK_EVENT, onAsk);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(V3_ASK_EVENT, onAsk);
      window.removeEventListener("keydown", onKey);
    };
  }, [openAsk, closeAsk]);

  return (
    <>
      {children}
      <div
        className={`h3-ov ${ask.open ? "open" : ""}`}
        onClick={closeAsk}
      />
      <AskPanel open={ask.open} about={ask.about} onClose={closeAsk} />
    </>
  );
}
