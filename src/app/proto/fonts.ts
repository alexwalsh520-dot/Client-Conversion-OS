/**
 * Type pairings for the prototype.
 *
 * Loaded through next/font so they are self-hosted and swap without a flash.
 * Each pair names a heading face, a UI/body face and a mono face — the mono is
 * what numbers in tables are set in, which is most of what CCOS shows.
 *
 * Kept to seven. Every extra family is real weight in the bundle, and past
 * seven you stop comparing and start browsing.
 */

import {
  Inter,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Instrument_Sans,
  Instrument_Serif,
  Source_Sans_3,
  Source_Serif_4,
  Manrope,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
  Geist,
  Geist_Mono,
} from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"] });
const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: ["400"] });
const sourceSans = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600"] });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"] });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"] });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const geist = Geist({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"] });

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export type FontPair = {
  key: string;
  name: string;
  blurb: string;
  head: string;
  body: string;
  mono: string;
};

export const FONT_PAIRS: FontPair[] = [
  {
    key: "system",
    name: "System",
    blurb: "Whatever the machine already has. Loads instantly and never looks wrong, but never looks like anything either.",
    head: SYSTEM, body: SYSTEM, mono: SYSTEM_MONO,
  },
  {
    key: "inter",
    name: "Inter",
    blurb: "The default of serious software. Neutral to a fault, superb at small sizes, impossible to dislike.",
    head: inter.style.fontFamily, body: inter.style.fontFamily, mono: SYSTEM_MONO,
  },
  {
    key: "geist",
    name: "Geist + Geist Mono",
    blurb: "Vercel's pair. Slightly warmer than Inter with a mono built to sit beside it. Very current.",
    head: geist.style.fontFamily, body: geist.style.fontFamily, mono: geistMono.style.fontFamily,
  },
  {
    key: "plex",
    name: "IBM Plex",
    blurb: "Engineered rather than styled. Reads as infrastructure — the most straightforwardly enterprise option here.",
    head: plexSans.style.fontFamily, body: plexSans.style.fontFamily, mono: plexMono.style.fontFamily,
  },
  {
    key: "instrument",
    name: "Instrument Serif + Sans",
    blurb: "Serif headings over a clean sans. The one that reads expensive. Best when headings are short.",
    head: instrumentSerif.style.fontFamily, body: instrumentSans.style.fontFamily, mono: SYSTEM_MONO,
  },
  {
    key: "source",
    name: "Source Serif + Sans",
    blurb: "Adobe's pair, built for long documents. Sober, financial, closest to a printed report.",
    head: sourceSerif.style.fontFamily, body: sourceSans.style.fontFamily, mono: SYSTEM_MONO,
  },
  {
    key: "manrope",
    name: "Manrope + JetBrains",
    blurb: "Geometric and friendly with a strong mono. Softer than the rest without going playful.",
    head: manrope.style.fontFamily, body: manrope.style.fontFamily, mono: jetbrains.style.fontFamily,
  },
  {
    key: "jakarta",
    name: "Plus Jakarta Sans",
    blurb: "What CCOS uses today. Distinctive, a little rounder, more personality than Inter.",
    head: jakarta.style.fontFamily, body: jakarta.style.fontFamily, mono: SYSTEM_MONO,
  },
];
