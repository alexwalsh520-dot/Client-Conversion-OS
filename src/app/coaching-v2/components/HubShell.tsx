"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Drawer from "./Drawer";
import AskPanel from "./AskPanel";

type Ctx = {
  openClient: (id: number) => void;
  openAsk: (about?: string | null) => void;
  closeAll: () => void;
};
const HubCtx = createContext<Ctx | null>(null);
export const useHub = () => {
  const v = useContext(HubCtx);
  if (!v) throw new Error("useHub outside HubShell");
  return v;
};

/** Window event the sidebar fires so the Ask Ahmad panel can open from outside the page tree. */
export const ASK_EVENT = "ccos-v2-ask";

export default function HubShell({ children }: { children: React.ReactNode }) {
  const [clientId, setClientId] = useState<number | null>(null);
  const [ask, setAsk] = useState<{ open: boolean; about: string | null }>({ open: false, about: null });

  const openClient = useCallback((id: number) => { setAsk((a) => ({ ...a, open: false })); setClientId(id); }, []);
  const openAsk = useCallback((about?: string | null) => { setClientId(null); setAsk({ open: true, about: about ?? null }); }, []);
  const closeAll = useCallback(() => { setClientId(null); setAsk((a) => ({ ...a, open: false })); }, []);

  useEffect(() => {
    const onAsk = (e: Event) => openAsk((e as CustomEvent<{ about?: string }>).detail?.about ?? null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll(); };
    window.addEventListener(ASK_EVENT, onAsk);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(ASK_EVENT, onAsk); window.removeEventListener("keydown", onKey); };
  }, [openAsk, closeAll]);

  const overlayOpen = clientId !== null || ask.open;
  return (
    <HubCtx.Provider value={{ openClient, openAsk, closeAll }}>
      {children}
      <div className={`h2-ov ${overlayOpen ? "open" : ""}`} onClick={closeAll} />
      <Drawer clientId={clientId} onClose={closeAll} onAsk={(about) => openAsk(about)} />
      <AskPanel open={ask.open} about={ask.about} onClose={closeAll} />
    </HubCtx.Provider>
  );
}
