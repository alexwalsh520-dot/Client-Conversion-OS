import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "@/components/TopNav";
import AskClaudeButton from "@/components/AskClaudeButton";
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
  title: "Nerve",
  description: "Business Operating System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionWrapper>
          <TopNav />
          <main
            style={{
              minHeight: "100vh",
              paddingTop: 80,
              paddingLeft: 40,
              paddingRight: 40,
              paddingBottom: 40,
              maxWidth: 1200,
              margin: "0 auto",
            }}
          >
            {children}
          </main>
          <AskClaudeButton />
        </SessionWrapper>
      </body>
    </html>
  );
}
