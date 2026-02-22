// The Intelligence Engine — CCOS's brain
// Analyzes business data and produces prioritized insights

import type { InsightCard, MoneyOnTable, BottleneckAnalysis, AdSpendScenario } from './types';
import { BENCHMARKS } from './constants';
import {
  revenueData,
  adPerformance,
  salesFunnel,
  funnelStages,
  coachPerformance,
  coachingFeedback,
  onboardingTracker,
  salesData,
  constraintAnalysis,
  coachingData,
} from './mock-data';

// ─── Money on the Table ──────────────────────────────────────────────

export function computeMoneyOnTable(): MoneyOnTable {
  const breakdown: BottleneckAnalysis[] = [];

  // 1. Show-up rate gap (60-min calls)
  const totalBooked60 = (funnelStages.find(s => s.stage === '60-min Booked')?.keith ?? 0) +
    (funnelStages.find(s => s.stage === '60-min Booked')?.tyson ?? 0);
  const totalTaken60 = (funnelStages.find(s => s.stage === '60-min Taken')?.keith ?? 0) +
    (funnelStages.find(s => s.stage === '60-min Taken')?.tyson ?? 0);
  const currentShowUp = totalBooked60 > 0 ? (totalTaken60 / totalBooked60) * 100 : 0;
  const showUpGap = BENCHMARKS.showUpRate60Min - currentShowUp;
  if (showUpGap > 0) {
    const missedCalls = Math.round((showUpGap / 100) * totalBooked60);
    const closeRate = salesData.totalWon / salesData.liveCallsCompleted;
    const impact = Math.round(missedCalls * closeRate * BENCHMARKS.avgDealValue);
    breakdown.push({
      stage: '60-min Call Show-up Rate',
      currentRate: currentShowUp,
      benchmarkRate: BENCHMARKS.showUpRate60Min,
      gap: showUpGap,
      revenueImpact: impact,
      description: `${missedCalls} no-shows/mo at ${(closeRate * 100).toFixed(0)}% close rate`,
    });
  }

  // 2. Underperforming coaches (dynamic — flags ANY coach below benchmark)
  const underperformers = coachPerformance.filter(c => c.completionRate < BENCHMARKS.coachCompletionRate);
  for (const coach of underperformers) {
    const avgRevenuePerClient = revenueData.total.thisMonth /
      (coachingData.keith.activeClients + coachingData.tyson.activeClients);
    const atRiskClients = Math.round(coach.activeClients * (1 - coach.completionRate / 100) * 0.5);
    const impact = Math.round(atRiskClients * avgRevenuePerClient);
    breakdown.push({
      stage: `${coach.name}'s Completion Rate`,
      currentRate: coach.completionRate,
      benchmarkRate: BENCHMARKS.coachCompletionRate,
      gap: BENCHMARKS.coachCompletionRate - coach.completionRate,
      revenueImpact: impact,
      description: `${atRiskClients} clients at churn risk due to ${coach.completionRate}% completion`,
    });
  }

  // 3. Ad spend scaling opportunity
  const totalSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const totalAdRevenue = adPerformance.keith.revenue + adPerformance.tyson.revenue;
  const currentROI = totalAdRevenue / totalSpend;
  const additionalSpend = totalSpend * 0.5;
  const additionalRevenue = Math.round(additionalSpend * currentROI * 0.9);
  breakdown.push({
    stage: 'Ad Spend Scaling',
    currentRate: totalSpend,
    benchmarkRate: totalSpend * 1.5,
    gap: additionalSpend,
    revenueImpact: additionalRevenue,
    description: `ROI is ${(currentROI * 100).toFixed(0)}%. Scaling 50% could add ~$${(additionalRevenue / 1000).toFixed(0)}K/mo`,
  });

  // 4. Ghosted onboarding clients
  const ghosted = onboardingTracker.filter(c => c.status === 'ghosted');
  if (ghosted.length > 0) {
    const ghostedRevenue = ghosted.reduce((sum, c) => {
      const amount = typeof c.amountPaid === 'number' ? c.amountPaid : parseFloat(String(c.amountPaid)) || 0;
      return sum + amount;
    }, 0);
    breakdown.push({
      stage: 'Ghosted Onboarding',
      currentRate: ghosted.length,
      benchmarkRate: 0,
      gap: ghosted.length,
      revenueImpact: ghostedRevenue,
      description: `${ghosted.length} clients stopped responding — $${ghostedRevenue.toLocaleString()} at risk`,
    });
  }

  // 5. Coach capacity limit
  const maxClientsPerCoach = 20;
  const nearCapacity = coachPerformance.filter(c => c.activeClients >= maxClientsPerCoach - 2);
  if (nearCapacity.length >= 2) {
    const potentialClientsPerCoach = 18;
    const avgRev = revenueData.total.thisMonth / (coachingData.keith.activeClients + coachingData.tyson.activeClients);
    const impact = Math.round(2 * potentialClientsPerCoach * avgRev);
    breakdown.push({
      stage: 'Coach Capacity',
      currentRate: nearCapacity.length,
      benchmarkRate: 0,
      gap: 2,
      revenueImpact: impact,
      description: `${nearCapacity.length} coaches near capacity — hiring 2 more unlocks ~$${(impact / 1000).toFixed(0)}K/mo`,
    });
  }

  const total = breakdown.reduce((sum, b) => sum + b.revenueImpact, 0);
  const biggest = breakdown.sort((a, b) => b.revenueImpact - a.revenueImpact)[0];

  return {
    total,
    breakdown: breakdown.sort((a, b) => b.revenueImpact - a.revenueImpact),
    biggestLever: biggest
      ? `Biggest lever: ${biggest.stage} — ${biggest.description}`
      : 'All systems running well',
  };
}

// ─── Insight Feed ────────────────────────────────────────────────────

export function generateInsightFeed(): InsightCard[] {
  const cards: InsightCard[] = [];

  // Alert: Flag any underperforming coaches dynamically
  const teamAvgCompletion = coachPerformance.reduce((s, c) => s + c.completionRate, 0) / coachPerformance.length;
  const underperformers = coachPerformance.filter(c => c.avgRating < BENCHMARKS.coachMinRating);
  for (const coach of underperformers) {
    const feedback = coachingFeedback.filter(f => f.coachName === coach.name);
    const recentIssue = feedback.length > 0
      ? feedback[0].wins || 'needs more personalized programming'
      : 'completion rate below benchmark';
    const avgRevenuePerClient = revenueData.total.thisMonth /
      (coachingData.keith.activeClients + coachingData.tyson.activeClients);
    const atRiskClients = Math.round(coach.activeClients * (1 - coach.completionRate / 100) * 0.5);
    const impactDollars = Math.round(atRiskClients * avgRevenuePerClient);
    cards.push({
      id: `alert-coach-${coach.name.toLowerCase()}`,
      type: 'alert',
      priority: 95,
      title: `${coach.name}'s clients need attention`,
      body: `His completion rate is ${coach.completionRate}% vs the team average of ${teamAvgCompletion.toFixed(0)}%. Client feedback mentions: "${recentIssue}". This puts ~$${(impactDollars / 1000).toFixed(1)}K/mo in retention revenue at risk.`,
      metric: {
        label: 'Completion Rate',
        value: `${coach.completionRate}%`,
        trend: 'down',
        isGood: false,
      },
      impactDollars,
      impactLabel: `$${(impactDollars / 1000).toFixed(1)}K/mo at risk`,
      actions: [
        { label: 'View feedback', type: 'navigate', payload: 'coaching' },
        { label: 'Log improvement plan', type: 'log', payload: 'team' },
      ],
      relatedArea: 'coaching',
      clientFilter: 'both',
    });
  }

  // Opportunity: Scale ad spend
  const totalSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const totalRevenue = adPerformance.keith.revenue + adPerformance.tyson.revenue;
  const roi = Math.round((totalRevenue / totalSpend) * 100);
  cards.push({
    id: 'opp-scale-ads',
    type: 'opportunity',
    priority: 90,
    title: `Your ROI is ${roi}% — time to scale`,
    body: `You're spending $${totalSpend.toLocaleString()}/mo and generating $${totalRevenue.toLocaleString()} in revenue. At this efficiency, increasing spend 50% to $${Math.round(totalSpend * 1.5).toLocaleString()} could add ~$${Math.round(totalSpend * 0.5 * (totalRevenue / totalSpend) * 0.9 / 1000)}K/mo in new revenue.`,
    metric: {
      label: 'Blended ROI',
      value: `${roi}%`,
      trend: 'up',
      isGood: true,
    },
    impactDollars: Math.round(totalSpend * 0.5 * (totalRevenue / totalSpend) * 0.9),
    impactLabel: `+$${Math.round(totalSpend * 0.5 * (totalRevenue / totalSpend) * 0.9 / 1000)}K/mo potential`,
    actions: [
      { label: 'Model scenarios', type: 'navigate', payload: 'ads' },
    ],
    relatedArea: 'ads',
    clientFilter: 'both',
  });

  // Bottleneck: Show-up rate
  const booked60 = (funnelStages.find(s => s.stage === '60-min Booked')?.keith ?? 0) +
    (funnelStages.find(s => s.stage === '60-min Booked')?.tyson ?? 0);
  const taken60 = (funnelStages.find(s => s.stage === '60-min Taken')?.keith ?? 0) +
    (funnelStages.find(s => s.stage === '60-min Taken')?.tyson ?? 0);
  const showUpRate = booked60 > 0 ? (taken60 / booked60 * 100) : 0;
  const noShows = booked60 - taken60;
  const closeRate = salesData.totalWon / salesData.liveCallsCompleted;
  const noShowCost = Math.round(noShows * closeRate * BENCHMARKS.avgDealValue);
  cards.push({
    id: 'bottleneck-showup',
    type: 'bottleneck',
    priority: 85,
    title: `${noShows} no-shows are costing you $${(noShowCost / 1000).toFixed(1)}K/mo`,
    body: `60-min call show-up rate is ${showUpRate.toFixed(1)}%. Each no-show costs ~$${Math.round(closeRate * BENCHMARKS.avgDealValue).toLocaleString()} in expected revenue. An SMS reminder sequence could recover 30-50% of these.`,
    metric: {
      label: 'Show-up Rate',
      value: `${showUpRate.toFixed(1)}%`,
      trend: 'down',
      isGood: false,
    },
    impactDollars: noShowCost,
    impactLabel: `$${(noShowCost / 1000).toFixed(1)}K/mo lost`,
    actions: [
      { label: 'View funnel', type: 'navigate', payload: 'funnel' },
    ],
    relatedArea: 'funnel',
    clientFilter: 'both',
  });

  // Win: Revenue growth
  const growth = revenueData.total.growthPercent;
  cards.push({
    id: 'win-revenue',
    type: 'win',
    priority: 80,
    title: `Revenue up ${growth}% to $${(revenueData.total.thisMonth / 1000).toFixed(1)}K`,
    body: `You grew from $${(revenueData.total.lastMonth / 1000).toFixed(1)}K to $${(revenueData.total.thisMonth / 1000).toFixed(1)}K this month. Keith brought in $${(revenueData.keith.thisMonth / 1000).toFixed(1)}K and Tyson $${(revenueData.tyson.combined.thisMonth / 1000).toFixed(1)}K. At this trajectory, $100K/mo is ${Math.ceil((100000 - revenueData.total.thisMonth) / (revenueData.total.thisMonth * growth / 100))}-${Math.ceil((100000 - revenueData.total.thisMonth) / (revenueData.total.thisMonth * growth / 100)) + 1} months away.`,
    metric: {
      label: 'Monthly Revenue',
      value: `$${(revenueData.total.thisMonth / 1000).toFixed(1)}K`,
      trend: 'up',
      isGood: true,
    },
    impactDollars: null,
    impactLabel: `+${growth}% vs last month`,
    actions: [
      { label: 'View breakdown', type: 'navigate', payload: 'ads' },
    ],
    relatedArea: 'ads',
    clientFilter: 'both',
  });

  // Alert: Ghosted clients
  const ghosted = onboardingTracker.filter(c => c.status === 'ghosted');
  if (ghosted.length > 0) {
    const ghostedRev = ghosted.reduce((s, c) => {
      const amt = typeof c.amountPaid === 'number' ? c.amountPaid : parseFloat(String(c.amountPaid)) || 0;
      return s + amt;
    }, 0);
    cards.push({
      id: 'alert-ghosted',
      type: 'alert',
      priority: 70,
      title: `${ghosted.length} clients ghosted during onboarding`,
      body: `These clients paid but stopped responding. That's $${ghostedRev.toLocaleString()} in revenue where you're not delivering value — and potential chargebacks. Nicole should follow up with a 48-hour recovery sequence.`,
      metric: {
        label: 'Ghosted Clients',
        value: String(ghosted.length),
        trend: 'up',
        isGood: false,
      },
      impactDollars: ghostedRev,
      impactLabel: `$${ghostedRev.toLocaleString()} at risk`,
      actions: [
        { label: 'View clients', type: 'navigate', payload: 'onboarding' },
      ],
      relatedArea: 'sales',
      clientFilter: 'both',
    });
  }

  // Experiment: DM script change
  cards.push({
    id: 'exp-dm-script',
    type: 'experiment',
    priority: 65,
    title: 'New DM script is converting 7% better',
    body: 'Since switching to testimonial-first openers on Feb 18, message-to-call conversion went from 9.6% to 10.3%. At current volume, that translates to ~3 extra calls booked per month.',
    metric: {
      label: 'Msg-to-Call Rate',
      value: '10.3%',
      trend: 'up',
      isGood: true,
    },
    impactDollars: 4100,
    impactLabel: '+$4,100/mo projected',
    actions: [
      { label: 'View in log', type: 'navigate', payload: 'log' },
    ],
    relatedArea: 'funnel',
    clientFilter: 'both',
  });

  return cards.sort((a, b) => b.priority - a.priority);
}

// ─── AI Briefing Generator ──────────────────────────────────────────

export function generateBriefing(): string {
  const totalRevenue = revenueData.total.thisMonth;
  const growth = revenueData.total.growthPercent;
  const totalSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const roi = Math.round((adPerformance.keith.revenue + adPerformance.tyson.revenue) / totalSpend * 100);

  const underperformers = coachPerformance.filter(c => c.completionRate < BENCHMARKS.coachCompletionRate);
  const ghosted = onboardingTracker.filter(c => c.status === 'ghosted');

  let briefing = `Revenue hit $${(totalRevenue / 1000).toFixed(1)}K this month, up ${growth}% from last month. Your blended ad ROI is running at ${roi}% — this is strong enough to scale spend.`;

  if (underperformers.length > 0) {
    briefing += ` Watch ${underperformers.map(c => c.name).join(' and ')} — completion rates are below the ${BENCHMARKS.coachCompletionRate}% benchmark, which puts retention at risk.`;
  }

  if (ghosted.length > 0) {
    briefing += ` ${ghosted.length} onboarding clients have gone silent — Nicole should prioritize recovery outreach today.`;
  }

  return briefing;
}

// ─── Ad Spend Scenario Modeler ───────────────────────────────────────

export function modelAdSpendScenario(newSpend: number): AdSpendScenario {
  const currentSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const currentRevenue = adPerformance.keith.revenue + adPerformance.tyson.revenue;
  const currentROI = currentRevenue / currentSpend;
  const totalClients = salesFunnel.keith.salesClosed + salesFunnel.tyson.salesClosed;
  const costPerClient = currentSpend / totalClients;

  // Diminishing returns: ROI drops 5% for every 50% increase in spend
  const spendRatio = newSpend / currentSpend;
  const diminishingFactor = Math.max(0.5, 1 - (spendRatio - 1) * 0.1);
  const projectedROI = currentROI * diminishingFactor;

  const projectedRevenue = Math.round(newSpend * projectedROI);
  const projectedClients = Math.round(newSpend / (costPerClient * (1 + (spendRatio - 1) * 0.15)));

  return {
    currentSpend,
    newSpend,
    currentROI: Math.round(currentROI * 100),
    projectedRevenue,
    projectedNewClients: projectedClients,
    revenueIncrease: projectedRevenue - currentRevenue,
  };
}
