import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import AccessGate from "@/components/AccessGate";
import GlassGlow from "@/components/GlassGlow";
import SessionWrapper from "@/components/SessionWrapper";
import ThemeInit from "@/components/ThemeInit";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CCOS",
  description: "Client Conversion OS",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Display faces for the sidebar wordmark easter egg (LogoWordmark). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@800&family=Sixtyfour&family=JetBrains+Mono:wght@800&family=Doto:wght@900&family=Silkscreen:wght@700&family=Jersey+10&family=Workbench&display=swap"
        />
        {/* Paint the last-used theme before hydration to avoid a flash. The
            signed-in user's own saved choice is reconciled by ThemeToggle once
            the session loads. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ccos-theme:last');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';}var c=document.documentElement.classList;c.remove('light','dark');c.add(t);}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionWrapper>
          <ThemeInit />
          <div className="app-layout">
            <Sidebar />
            <div className="app-shell">
              <main className="main-content">
                <AccessGate>{children}</AccessGate>
              </main>
            </div>
          </div>
          <GlassGlow />
        </SessionWrapper>
      </body>
    </html>
  );
}
