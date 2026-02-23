import {
  PaymentRequest,
  RoutingDecision,
  AcquirerScore,
  OptimizationMode,
  FallbackEntry,
  HealthStatus,
} from '../models/types';
import { acquirers } from '../config/acquirers';
import { performanceAnalyzer } from './performance-analyzer';

// Import HealthMonitor if available; default to healthy if not yet built.
let getHealthStatus: (acquirer: string) => HealthStatus;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const healthModule = require('./health-monitor');
  const monitor = healthModule.healthMonitor || healthModule.default;
  if (monitor && typeof monitor.getStatus === 'function') {
    getHealthStatus = (acq: string) => monitor.getStatus(acq);
  } else {
    getHealthStatus = defaultHealthStatus;
  }
} catch {
  getHealthStatus = defaultHealthStatus;
}

function defaultHealthStatus(acquirer: string): HealthStatus {
  return {
    acquirer,
    status: 'healthy',
    consecutiveFailures: 0,
    metrics: { successRate: 1, errorRate: 0, timeoutRate: 0, totalProcessed: 0 },
    lastUpdated: new Date().toISOString(),
  };
}

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

export class RoutingEngine {
  route(request: PaymentRequest): RoutingDecision {
    const mode: OptimizationMode = request.optimizationMode || 'balanced';
    const weights = MODE_WEIGHTS[mode];
    const maxTakeRate = Math.max(...acquirers.map(a => a.takeRate));

    const scores: AcquirerScore[] = [];

    for (const acq of acquirers) {
      if (!acq.enabled) continue;

      const health = getHealthStatus(acq.name);
      if (health.status === 'down') continue;

      const perf = performanceAnalyzer.getApprovalRate(acq.name, {
        currency: request.currency,
        cardType: request.cardType,
        country: request.country,
        amount: request.amount,
      });

      // Also check single-letter key (historical data uses "A", config uses "Acquirer A")
      const shortName = acq.name.replace('Acquirer ', '');
      const perfShort = performanceAnalyzer.getApprovalRate(shortName, {
        currency: request.currency,
        cardType: request.cardType,
        country: request.country,
        amount: request.amount,
      });

      // Use whichever has more data
      const bestPerf = perfShort.sampleSize > perf.sampleSize ? perfShort : perf;

      const approvalRateScore = bestPerf.approvalRate;
      const healthScore = HEALTH_SCORE_MAP[health.status] ?? 1.0;
      const costScore = 1 - acq.takeRate / maxTakeRate;

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

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // cost_conscious override: if cheapest acquirer's approval rate is >5pp lower than best, prefer best
    let selected = scores[0];
    if (mode === 'cost_conscious' && scores.length >= 2) {
      const cheapest = [...scores].sort((a, b) => a.takeRate - b.takeRate)[0];
      const bestApproval = [...scores].sort((a, b) => b.approvalRate - a.approvalRate)[0];
      if (
        cheapest.acquirer !== bestApproval.acquirer &&
        bestApproval.approvalRate - cheapest.approvalRate > 0.05
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

    // Build fallback sequence from remaining acquirers in score order
    const fallbackSequence: FallbackEntry[] = scores
      .filter(s => s.acquirer !== selected.acquirer)
      .map(s => ({
        acquirer: s.acquirer,
        expectedApprovalRate: s.approvalRate,
        reason: `Fallback: ${(s.approvalRate * 100).toFixed(0)}% approval, ${s.healthStatus} health, ${s.takeRate}% take rate`,
      }));

    return {
      selectedAcquirer: selected.acquirer,
      scores,
      justification,
      optimizationMode: mode,
      fallbackSequence,
    };
  }
}

export const routingEngine = new RoutingEngine();
