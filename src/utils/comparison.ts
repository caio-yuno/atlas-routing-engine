import * as path from 'path';
import * as fs from 'fs';
import { Transaction, PaymentRequest } from '../models/types';
import { PerformanceAnalyzer } from '../services/performance-analyzer';
import { RoutingEngine, HealthProvider } from '../services/routing-engine';
import { HealthStatus } from '../models/types';

interface SegmentImprovement {
  segment: string;
  smartRate: number;
  roundRobinRate: number;
  liftPp: number;
}

interface ComparisonResult {
  smartApprovalRate: number;
  roundRobinApprovalRate: number;
  liftPp: number;
  estimatedMonthlyRevenueLift: number;
  perAcquirerDistribution: Record<string, { count: number; percentage: number }>;
  perSegmentImprovements: SegmentImprovement[];
}

/**
 * True counterfactual simulation.
 *
 * For each historical transaction we ask: "If we had routed this transaction
 * to acquirer X instead of the acquirer it actually went to, what would the
 * outcome have been?"
 *
 * We build per-acquirer, per-segment outcome lookup tables from historical data.
 * When the routing engine selects the same acquirer that was actually used, we
 * use the real outcome. When it selects a different acquirer, we sample from
 * that acquirer's historical outcomes for the same segment (currency × cardType
 * × amountRange) to estimate the counterfactual outcome.
 *
 * This is more accurate than using the aggregate approval rate as a probability,
 * because it preserves the variance and correlation structure of the real data.
 */
export function runComparison(): ComparisonResult {
  const historicalPath = path.resolve(__dirname, '../data/historical.json');
  const historical: Transaction[] = JSON.parse(fs.readFileSync(historicalPath, 'utf-8'));

  const performanceAnalyzer = new PerformanceAnalyzer();
  // Use a healthy-everywhere provider for fair comparison (no health bias)
  const neutralHealth: HealthProvider = {
    getHealth: (acq: string): HealthStatus => ({
      acquirer: acq,
      status: 'healthy',
      consecutiveFailures: 0,
      metrics: { successRate: 1, errorRate: 0, timeoutRate: 0, totalProcessed: 0 },
      lastUpdated: new Date().toISOString(),
    }),
    isAvailable: () => true,
  };
  const routingEngine = new RoutingEngine(performanceAnalyzer, neutralHealth);

  const acquirerNames = ['A', 'B', 'C'];

  // --- Build counterfactual lookup tables ---
  // Key: "acquirer:currency:cardType:amountRange" → array of outcomes
  const outcomeTable: Record<string, ('approved' | 'other')[]> = {};

  function getAmountRange(amount: number): string {
    if (amount <= 100) return 'low';
    if (amount <= 500) return 'mid';
    return 'high';
  }

  for (const tx of historical) {
    const range = getAmountRange(tx.amount);
    const key = `${tx.acquirer}:${tx.currency}:${tx.cardType}:${range}`;
    if (!outcomeTable[key]) outcomeTable[key] = [];
    outcomeTable[key].push(tx.outcome === 'approved' ? 'approved' : 'other');
  }

  // Deterministic counterfactual sampler: cycles through outcomes for the segment
  const sampleCounters: Record<string, number> = {};
  function counterfactualOutcome(acquirer: string, currency: string, cardType: string, amount: number): boolean {
    const range = getAmountRange(amount);
    const key = `${acquirer}:${currency}:${cardType}:${range}`;
    const outcomes = outcomeTable[key];
    if (!outcomes || outcomes.length === 0) {
      // Fall back to acquirer-level baseline
      const baselineKey = acquirer;
      const baselineOutcomes = outcomeTable[baselineKey];
      if (!baselineOutcomes) return false;
      const idx = (sampleCounters[baselineKey] || 0) % baselineOutcomes.length;
      sampleCounters[baselineKey] = idx + 1;
      return baselineOutcomes[idx] === 'approved';
    }
    const idx = (sampleCounters[key] || 0) % outcomes.length;
    sampleCounters[key] = idx + 1;
    return outcomes[idx] === 'approved';
  }

  // --- Round-robin simulation (true counterfactual) ---
  let rrApproved = 0;
  const rrSegments: Record<string, { approved: number; total: number }> = {};

  for (let i = 0; i < historical.length; i++) {
    const tx = historical[i];
    const rrAcquirer = acquirerNames[i % acquirerNames.length];

    let approved: boolean;
    if (rrAcquirer === tx.acquirer) {
      // Same acquirer — use actual outcome
      approved = tx.outcome === 'approved';
    } else {
      // Different acquirer — counterfactual sample
      approved = counterfactualOutcome(rrAcquirer, tx.currency, tx.cardType, tx.amount);
    }

    if (approved) rrApproved++;

    // Track per-segment
    const segs = [
      `currency:${tx.currency}`,
      `cardType:${tx.cardType}`,
      `amount:${getAmountRange(tx.amount)}`,
    ];
    for (const seg of segs) {
      if (!rrSegments[seg]) rrSegments[seg] = { approved: 0, total: 0 };
      rrSegments[seg].total++;
      if (approved) rrSegments[seg].approved++;
    }
  }

  // Reset sample counters for smart routing simulation
  for (const key of Object.keys(sampleCounters)) {
    sampleCounters[key] = 0;
  }

  // --- Smart routing simulation (true counterfactual) ---
  let smartApproved = 0;
  const routingDistribution: Record<string, number> = {};
  const smartSegments: Record<string, { approved: number; total: number }> = {};

  for (const tx of historical) {
    const request: PaymentRequest = {
      amount: tx.amount,
      currency: tx.currency,
      cardType: tx.cardType,
      country: tx.country,
    };

    const decision = routingEngine.route(request);
    const selectedShort = decision.selectedAcquirer.replace('Acquirer ', '');

    // Track distribution
    routingDistribution[decision.selectedAcquirer] =
      (routingDistribution[decision.selectedAcquirer] || 0) + 1;

    let approved: boolean;
    if (selectedShort === tx.acquirer) {
      // Same acquirer — use actual outcome
      approved = tx.outcome === 'approved';
    } else {
      // Different acquirer — counterfactual sample
      approved = counterfactualOutcome(selectedShort, tx.currency, tx.cardType, tx.amount);
    }

    if (approved) smartApproved++;

    // Track per-segment
    const segs = [
      `currency:${tx.currency}`,
      `cardType:${tx.cardType}`,
      `amount:${getAmountRange(tx.amount)}`,
    ];
    for (const seg of segs) {
      if (!smartSegments[seg]) smartSegments[seg] = { approved: 0, total: 0 };
      smartSegments[seg].total++;
      if (approved) smartSegments[seg].approved++;
    }
  }

  const smartApprovalRate = smartApproved / historical.length;
  const roundRobinApprovalRate = rrApproved / historical.length;
  const liftPp = Math.round((smartApprovalRate - roundRobinApprovalRate) * 10000) / 100;

  // Revenue lift: $15K per percentage point
  const estimatedMonthlyRevenueLift = Math.round(liftPp * 15000 * 100) / 100;

  // Per-acquirer distribution
  const perAcquirerDistribution: Record<string, { count: number; percentage: number }> = {};
  for (const [acq, count] of Object.entries(routingDistribution)) {
    perAcquirerDistribution[acq] = {
      count,
      percentage: Math.round((count / historical.length) * 10000) / 100,
    };
  }

  // Per-segment improvements
  const perSegmentImprovements: SegmentImprovement[] = [];
  for (const seg of Object.keys(smartSegments)) {
    const smart = smartSegments[seg];
    const rr = rrSegments[seg];
    if (!smart || !rr || rr.total === 0 || smart.total === 0) continue;
    const smartRate = smart.approved / smart.total;
    const rrRate = rr.approved / rr.total;
    perSegmentImprovements.push({
      segment: seg,
      smartRate: Math.round(smartRate * 10000) / 10000,
      roundRobinRate: Math.round(rrRate * 10000) / 10000,
      liftPp: Math.round((smartRate - rrRate) * 10000) / 100,
    });
  }

  // Sort by lift descending
  perSegmentImprovements.sort((a, b) => b.liftPp - a.liftPp);

  return {
    smartApprovalRate: Math.round(smartApprovalRate * 10000) / 10000,
    roundRobinApprovalRate: Math.round(roundRobinApprovalRate * 10000) / 10000,
    liftPp,
    estimatedMonthlyRevenueLift,
    perAcquirerDistribution,
    perSegmentImprovements,
  };
}
