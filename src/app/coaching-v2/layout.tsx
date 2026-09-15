import "./hub.css";
import HubShell from "./components/HubShell";

export const dynamic = "force-dynamic";

export default function CoachingV2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h2">
      <HubShell>{children}</HubShell>
    </div>
  );
}
