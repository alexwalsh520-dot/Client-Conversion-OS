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
    days: c.days,
    score: c.score,
    lastCall: c.lastMeetDays,
    owed: c.owedDays,
    health: c.health,
    status: c.status,
    lastMsg: c.messages[0] ? { who: c.messages[0].sender, text: c.messages[0].text, daysAgo: c.messages[0].daysAgo } : null,
    nutritionWait: c.nutritionWaitDays,
  }));
  return <ClientsTable rows={rows} manager={!hub.viewer.coach} />;
}
