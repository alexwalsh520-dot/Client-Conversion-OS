// Shared TypeScript interfaces for NERVE

export interface InsightCard {
  id: string;
  type: 'alert' | 'opportunity' | 'win' | 'experiment' | 'bottleneck';
  priority: number;
  title: string;
  body: string;
  metric: {
    label: string;
    value: string;
    trend: 'up' | 'down' | 'flat';
    isGood: boolean;
  };
  impactDollars: number | null;
  impactLabel: string;
  actions: {
    label: string;
    type: 'navigate' | 'log' | 'slack' | 'model';
    payload: string;
  }[];
  relatedArea: 'funnel' | 'sales' | 'coaching' | 'ads';
  clientFilter: 'keith' | 'tyson' | 'both';
}

export interface BottleneckAnalysis {
  stage: string;
  currentRate: number;
  benchmarkRate: number;
  gap: number;
  revenueImpact: number;
  description: string;
}

export interface MoneyOnTable {
  total: number;
  breakdown: BottleneckAnalysis[];
  biggestLever: string;
}

export interface AdSpendScenario {
  currentSpend: number;
  newSpend: number;
  currentROI: number;
  projectedRevenue: number;
  projectedNewClients: number;
  revenueIncrease: number;
}

export type ClientFilter = 'keith' | 'tyson' | 'both';
export type XRayTab = 'funnel' | 'sales' | 'coaching' | 'ads';
