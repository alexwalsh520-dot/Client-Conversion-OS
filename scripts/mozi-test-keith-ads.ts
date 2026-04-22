import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
import { fetchKeithAdSpendLast30d } from '../src/lib/mozi-keith-ads';

async function main() {
  const r = await fetchKeithAdSpendLast30d();
  console.log('Total cents:', r.totalCents, '($' + (r.totalCents / 100).toFixed(2) + ')');
  console.log('Days covered:', r.daysCovered);
  console.log('First 5:', r.dailyLines.slice(0, 5));
  console.log('Last 5:', r.dailyLines.slice(-5));
}
main().catch((e) => { console.error(e); process.exit(1); });
