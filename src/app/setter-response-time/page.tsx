import type { Metadata } from "next";
import SetterResponseTimesView from "./SetterResponseTimesView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Setter Response Time",
};

export default function SetterResponseTimePage() {
  return <SetterResponseTimesView />;
}
