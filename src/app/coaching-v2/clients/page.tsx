import { loadHub } from "@/lib/coaching-v2/hub";
import ClientsTable, { type Row } from "../components/ClientsTable";

export default async function ClientsPage() {
  const hub = await loadHub();
  if (!hub) return null;
  const rows: Row[] = hub.clients.map((c) => ({
    id: c.id,
    name: c.name,
    coach: c.coach,
    stage: c.stage,
    renewed: c.asks[2].done && c.status === "active",
    days: c.days,
    score: c.score,
    owed: c.owedDays,
    paid: c.paid,
    health: c.health,
    status: c.status,
    lastMsg: c.messages[0] ? { who: c.messages[0].sender, text: c.messages[0].text, daysAgo: c.messages[0].daysAgo } : null,
    nutritionWait: c.nutritionWaitDays,
    askDue: c.asks.some((a) => !a.done && !a.asked && a.dueDays !== null && a.dueDays <= 14),
  }));
  return <ClientsTable rows={rows} manager={!hub.viewer.coach} coaches={hub.coaches} canAdd={hub.viewer.isAdmin || !!hub.viewer.coach} defaultCoach={hub.viewer.coach ?? ""} />;
}
