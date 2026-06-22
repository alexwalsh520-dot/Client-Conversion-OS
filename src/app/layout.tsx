import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import AccessGate from "@/components/AccessGate";
import GlassGlow from "@/components/GlassGlow";
import SessionWrapper from "@/components/SessionWrapper";

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
          <div className="app-layout">
            <Sidebar />
            <main className="main-content">
              <AccessGate>{children}</AccessGate>
            </main>
          </div>
          <GlassGlow />
        </SessionWrapper>
      </body>
    </html>
  );
}
