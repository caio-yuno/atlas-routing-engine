import {
  PaymentRequest,
  RoutingDecision,
  AcquirerScore,
  OptimizationMode,
  FallbackEntry,
  HealthStatus,
} from '../models/types';
import { acquirers } from '../config/acquirers';
import { PerformanceAnalyzer } from './performance-analyzer';

export interface HealthProvider {
  getHealth(acquirer: string): HealthStatus;
  isAvailable(acquirer: string): boolean;
}

const COST_CONSCIOUS_APPROVAL_THRESHOLD_PP = 0.05; // 5 percentage points

const HEALTH_SCORE_MAP: Record<string, number> = {
  healthy: 1.0,
  degraded: 0.3,
  down: 0.0,
};

const MODE_WEIGHTS: Record<OptimizationMode, { approval: number; health: number; cost: number }> = {
  maximize_approvals: { approval: 0.80, health: 0.15, cost: 0.05 },
  balanced:           { approval: 0.60, health: 0.25, cost: 0.15 },
  cost_conscious:     { approval: 0.40, health: 0.20, cost: 0.40 },
};

const DEFAULT_HEALTH: HealthStatus = {
  acquirer: '',
  status: 'healthy',
  consecutiveFailures: 0,
  metrics: { successRate: 1, errorRate: 0, timeoutRate: 0, totalProcessed: 0 },
  lastUpdated: '',
};

/**
 * Resolves the best performance data for an acquirer by checking both
 * the full name ("Acquirer A") and short name ("A") against historical data.
 */
function resolvePerformance(
  analyzer: PerformanceAnalyzer,
  acquirerName: string,
  filters: { currency?: string; cardType?: string; country?: string; amount?: number },
) {
  const shortName = acquirerName.replace('Acquirer ', '');
  const perfFull = analyzer.getApprovalRate(acquirerName, filters);
  const perfShort = analyzer.getApprovalRate(shortName, filters);
  return perfShort.sampleSize > perfFull.sampleSize ? perfShort : perfFull;
}

export class RoutingEngine {
  private performanceAnalyzer: PerformanceAnalyzer;
  private healthProvider: HealthProvider;

  constructor(performanceAnalyzer: PerformanceAnalyzer, healthProvider?: HealthProvider) {
    this.performanceAnalyzer = performanceAnalyzer;
    this.healthProvider = healthProvider || {
      getHealth: (acq: string) => ({ ...DEFAULT_HEALTH, acquirer: acq, lastUpdated: new Date().toISOString() }),
      isAvailable: () => true,
    };
  }

  route(request: PaymentRequest): RoutingDecision {
    const mode: OptimizationMode = request.optimizationMode || 'balanced';
    const weights = MODE_WEIGHTS[mode];
    const maxTakeRate = Math.max(...acquirers.map(a => a.takeRate));

    const scores: AcquirerScore[] = [];

    for (const acq of acquirers) {
      if (!acq.enabled) continue;

      const health = this.healthProvider.getHealth(acq.name);
      if (health.status === 'down') continue;

      const bestPerf = resolvePerformance(this.performanceAnalyzer, acq.name, {
        currency: request.currency,
        cardType: request.cardType,
        country: request.country,
        amount: request.amount,
      });

      const approvalRateScore = bestPerf.approvalRate;
      const healthScore = HEALTH_SCORE_MAP[health.status] ?? 1.0;
      const costScore = maxTakeRate > 0 ? 1 - acq.takeRate / maxTakeRate : 0;

      const totalScore =
        weights.approval * approvalRateScore +
        weights.health * healthScore +
        weights.cost * costScore;

      scores.push({
        acquirer: acq.name,
        totalScore,
        approvalRateScore,
        healthScore,
        costScore,
        approvalRate: bestPerf.approvalRate,
        healthStatus: health.status,
        takeRate: acq.takeRate,
      });
    }

    // [C1] Handle case where all acquirers are down
    if (scores.length === 0) {
      return {
        selectedAcquirer: 'NONE',
        scores: [],
        justification: 'No acquirers available — all are currently down. Retry after acquirer recovery.',
        optimizationMode: mode,
        fallbackSequence: [],
      };
    }

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // [C2] cost_conscious override: prefer best approval rate acquirer if cheapest is >5pp lower,
    // but only consider healthy acquirers for the override (not degraded)
    let selected = scores[0];
    if (mode === 'cost_conscious' && scores.length >= 2) {
      const cheapest = [...scores].sort((a, b) => a.takeRate - b.takeRate)[0];
      const healthyScores = scores.filter(s => s.healthStatus === 'healthy');
      const bestApproval = (healthyScores.length > 0 ? healthyScores : scores)
        .sort((a, b) => b.approvalRate - a.approvalRate)[0];
      if (
        cheapest.acquirer !== bestApproval.acquirer &&
        bestApproval.approvalRate - cheapest.approvalRate > COST_CONSCIOUS_APPROVAL_THRESHOLD_PP
      ) {
        selected = bestApproval;
      }
    }

    // Build justification
    const selectedPct = (selected.approvalRate * 100).toFixed(0);
    const others = scores
      .filter(s => s.acquirer !== selected.acquirer)
      .map(s => `${(s.approvalRate * 100).toFixed(0)}% (${s.acquirer.replace('Acquirer ', '')})`)
      .join(' and ');

    const segmentLabel = `${request.currency} ${request.cardType} cards`;
    const justification = `Route to ${selected.acquirer}: ${selectedPct}% approval for ${segmentLabel} vs ${others}. Mode: ${mode}`;

    return {
      selectedAcquirer: selected.acquirer,
      scores,
      justification,
      optimizationMode: mode,
      fallbackSequence: [], // Populated by FallbackSequencer at the API layer
    };
  }
}
