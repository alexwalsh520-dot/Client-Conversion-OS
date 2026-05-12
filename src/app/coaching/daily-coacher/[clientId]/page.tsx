/**
 * Daily Coacher — per-client view.
 *
 * Server component. Validates the clientId, fetches the initial input bundle
 * (summary state + program progress + the coach/client name strings the
 * client component needs for sub-API calls), and hands off to the
 * interactive client component.
 *
 * Auth check is bypassed here; the API routes the client component talks
 * to enforce auth themselves. Visiting an unauthorized URL just shows
 * empty/error states until those API calls return 401, which is fine.
 */

import { notFound } from "next/navigation";
import { gatherSummaryInputs, isSummaryStale } from "@/lib/daily-coacher/summary-inputs";
import DailyCoacherView from "@/components/daily-coacher/DailyCoacherView";

export const dynamic = "force-dynamic";

export default async function DailyCoacherPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId: clientIdRaw } = await params;
  const clientId = parseInt(clientIdRaw, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    notFound();
  }

  const inputs = await gatherSummaryInputs(clientId);
  if (!inputs) {
    notFound();
  }

  return (
    <DailyCoacherView
      clientId={clientId}
      clientName={inputs.client.name}
      coachName={inputs.client.coach_name ?? "(unassigned)"}
      program={inputs.client.program ?? "(no program)"}
      offer={inputs.client.offer ?? null}
      progress={inputs.progress}
      initialSummary={inputs.client.daily_coacher_summary ?? null}
      initialSummaryUpdatedAt={inputs.client.daily_coacher_summary_updated_at ?? null}
      initialStale={isSummaryStale(inputs)}
    />
  );
}
