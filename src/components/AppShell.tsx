"use client";

import { usePathname } from "next/navigation";
import AccessGate from "@/components/AccessGate";
import GlassGlow from "@/components/GlassGlow";
import SessionWrapper from "@/components/SessionWrapper";
import Sidebar from "@/components/Sidebar";
import { allowsMarketingBrainPreviewAccess } from "@/lib/marketing-brain/preview-access";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (allowsMarketingBrainPreviewAccess(pathname)) {
    return (
      <main className="main-content">
        {children}
      </main>
    );
  }

  return (
    <SessionWrapper>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <AccessGate>{children}</AccessGate>
        </main>
      </div>
      <GlassGlow />
    </SessionWrapper>
  );
}
