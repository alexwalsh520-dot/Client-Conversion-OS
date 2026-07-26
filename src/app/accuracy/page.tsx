import "./accuracy.css";
import AccuracyClient from "./AccuracyClient";

// Behind the same login gate as every other CCOS tab (AccessGate in the root
// layout). No public route on this page.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Accuracy",
};

export default function AccuracyPage() {
  return <AccuracyClient />;
}
