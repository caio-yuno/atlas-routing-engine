export type Outcome = 'approved' | 'declined' | 'error' | 'timeout';
export type CardType = 'credit' | 'debit';
export type Currency = 'MXN' | 'BRL' | 'USD';
export type Country = 'MX' | 'BR' | 'US';
export type OptimizationMode = 'maximize_approvals' | 'balanced' | 'cost_conscious';

export interface Transaction {
  id: string;
  timestamp: string;
  acquirer: string;
  amount: number;
  currency: Currency;
  cardType: CardType;
  country: Country;
  outcome: Outcome;
  takeRate: number;
  processingTimeMs: number;
}

export interface PaymentRequest {
  amount: number;
  currency: Currency;
  cardType: CardType;
  country: Country;
  optimizationMode?: OptimizationMode;
}

export interface AcquirerScore {
  acquirer: string;
  totalScore: number;
  approvalRateScore: number;
  healthScore: number;
  costScore: number;
  approvalRate: number;
  healthStatus: 'healthy' | 'degraded' | 'down';
  takeRate: number;
}

export interface FallbackEntry {
  acquirer: string;
  expectedApprovalRate: number;
  reason: string;
}

export interface RoutingDecision {
  selectedAcquirer: string;
  scores: AcquirerScore[];
  justification: string;
  optimizationMode: OptimizationMode;
  fallbackSequence: FallbackEntry[];
}

export interface AcquirerConfig {
  name: string;
  takeRate: number;
  enabled: boolean;
  description: string;
}

export interface HealthStatus {
  acquirer: string;
  status: 'healthy' | 'degraded' | 'down';
  consecutiveFailures: number;
  metrics: {
    successRate: number;
    errorRate: number;
    timeoutRate: number;
    totalProcessed: number;
  };
  lastUpdated: string;
}

export interface AcquirerPerformance {
  acquirer: string;
  approvalRate: number;
  sampleSize: number;
  segment: string;
}
