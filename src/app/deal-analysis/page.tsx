import { redirect } from "next/navigation";

// Friendly alias: the page lives at /micromanager, branded as Deal Analysis.
export default function DealAnalysisAlias() {
  redirect("/micromanager");
}
