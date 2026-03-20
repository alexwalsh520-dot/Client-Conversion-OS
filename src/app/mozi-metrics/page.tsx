import { getDashboardData } from '@/lib/mozi-data';
import DashboardShell from '@/components/mozi/DashboardShell';

export default async function MoziMetricsPage() {
  const data = await getDashboardData();
  return <DashboardShell data={data} />;
}
