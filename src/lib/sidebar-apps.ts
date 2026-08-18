/**
 * The sidebar's app list, shared by the Sidebar and by Settings → Apps.
 *
 * Hiding an app is a per-person preference kept in localStorage, not a
 * permission. Permissions still come from the session (role + allowedTabs);
 * hiding only decides whether an app you already have access to shows up in
 * your sidebar. You add a hidden app back from Settings → Apps.
 */

import {
  Home,
  Users,
  Megaphone,
  Rocket,
  BarChart3,
  Calculator,
  Monitor,
  Sparkles,
  BookOpen,
  FileText,
  Star,
  Receipt,
  Clapperboard,
  Handshake,
  Utensils,
  UserRound,
  Pill,
  Trophy,
  FlaskConical,
  MessageCircle,
  Factory,
  Film,
  Timer,
  ClipboardCheck,
  ListTodo,
  Magnet,
  Target,
} from "lucide-react";

export type AppItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Restricts the app to exactly one person — overrides the admin bypass. */
  ownerEmail?: string;
  adminOnly?: boolean;
};

export const NAV_ITEMS: AppItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/outreach-runs", label: "Client Acquisition", icon: Rocket },
  { href: "/studio-2/auto-outreach-test", label: "Auto Outreach", icon: FileText },
  { href: "/sales-hub", label: "Sales Hub", icon: BarChart3 },
  { href: "/time-to-eat", label: "Time to Eat", icon: Utensils },
  { href: "/setter-response-time", label: "Setter Response Time", icon: Timer },
  { href: "/lead-magnet", label: "Lead Magnet Funnel", icon: Magnet },
  { href: "/coaching", label: "Coaching", icon: Users },
  { href: "/partner-onboarding", label: "Client Onboarding", icon: Handshake },
  { href: "/testimonials", label: "Testimonials", icon: Star },
  { href: "/testimonials/videos", label: "Video Testimonials", icon: Clapperboard },
  { href: "/accountant", label: "Accountant", icon: Calculator },
  { href: "/sop", label: "SOPs", icon: BookOpen },
  // Private single-owner tabs — gated to ownerEmail in canViewApp (overrides admin).
  { href: "/micromanager", label: "Micromanager", icon: ClipboardCheck, ownerEmail: "alexwalsh520@gmail.com" },
  { href: "/todos", label: "ToDos", icon: ListTodo, ownerEmail: "alexwalsh520@gmail.com" },
  { href: "/supplements", label: "Supplements", icon: Pill, ownerEmail: "matthew@clientconversion.io" },
  { href: "/invoicing-payouts", label: "Invoicing & Payouts", icon: Receipt, ownerEmail: "matthew@clientconversion.io" },
];

export const MARKETING_NAV_ITEMS: AppItem[] = [
  { href: "/cmo", label: "CMO", icon: UserRound },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/ads-v2", label: "Ads v2", icon: Megaphone },
  { href: "/manager-ads", label: "Manager Ads View", icon: BarChart3 },
  { href: "/dms", label: "DMs", icon: MessageCircle },
  { href: "/icp", label: "ICP", icon: Target },
  { href: "/content", label: "Content", icon: Film },
  { href: "/lab", label: "Lab", icon: FlaskConical },
  { href: "/factory", label: "Factory", icon: Factory },
  { href: "/ads-leaderboard", label: "Ads Leaderboard", icon: Trophy },
  { href: "/live-ads", label: "Live Ads", icon: Monitor },
  { href: "/studio-2", label: "Studio 2.0", icon: Sparkles },
];

export const ALL_APPS: AppItem[] = [...NAV_ITEMS, ...MARKETING_NAV_ITEMS];

export const HIDDEN_TABS_KEY = "sidebar-hidden-tabs";

/**
 * Fired on `window` whenever the hidden list changes, so the Sidebar and the
 * Settings panel stay in step. A plain `storage` event will not do — the
 * browser only fires that for OTHER tabs, never the one doing the writing.
 */
export const HIDDEN_TABS_EVENT = "sidebar-hidden-tabs-changed";

export function readHiddenTabs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_TABS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenTabs(next: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(HIDDEN_TABS_EVENT));
}

export type ViewerAccess = {
  isAdmin: boolean;
  userEmail?: string;
  allowedTabs?: string[];
  hasPermissions: boolean;
};

/** Whether this person is allowed the app at all. Hiding is applied separately. */
export function canViewApp(item: AppItem, v: ViewerAccess): boolean {
  if (item.ownerEmail) return v.userEmail === item.ownerEmail.toLowerCase();
  if (item.adminOnly) return v.isAdmin;
  return (
    !v.hasPermissions ||
    v.isAdmin ||
    !!v.allowedTabs?.includes(item.href) ||
    (item.href === "/time-to-eat" && !!v.allowedTabs?.includes("/sales-hub")) ||
    // Setter Response Time rides on Sales Hub access (it's the front-facing
    // cut of the same response-times data).
    (item.href === "/setter-response-time" && !!v.allowedTabs?.includes("/sales-hub")) ||
    // Lead Magnet Funnel rides on Sales Hub access the same way.
    (item.href === "/lead-magnet" && !!v.allowedTabs?.includes("/sales-hub")) ||
    // Video Testimonials manager rides on Coaching access (view + download).
    (item.href === "/testimonials/videos" && !!v.allowedTabs?.includes("/coaching"))
  );
}
