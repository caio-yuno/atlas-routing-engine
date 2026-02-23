import { Outcome, HealthStatus, Transaction } from '../models/types';

const WINDOW_SIZE = 20;
const CONSECUTIVE_FAILURES_DOWN = 5;
const CONSECUTIVE_SUCCESSES_RECOVERY = 3;

interface AcquirerState {
  recentOutcomes: Outcome[];
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  status: 'healthy' | 'degraded' | 'down';
  lastUpdated: string;
  totalProcessed: number;
}

function isFailure(outcome: Outcome): boolean {
  return outcome === 'error' || outcome === 'timeout';
}

function isSuccess(outcome: Outcome): boolean {
  return outcome === 'approved' || outcome === 'declined';
}

class HealthMonitor {
  private state: Map<string, AcquirerState> = new Map();

  private getOrCreateState(acquirer: string): AcquirerState {
    let s = this.state.get(acquirer);
    if (!s) {
      s = {
        recentOutcomes: [],
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        status: 'healthy',
        lastUpdated: new Date().toISOString(),
        totalProcessed: 0,
      };
      this.state.set(acquirer, s);
    }
    return s;
  }

  private computeRates(outcomes: Outcome[]) {
    if (outcomes.length === 0) {
      return { successRate: 1, errorRate: 0, timeoutRate: 0 };
    }
    let successes = 0, errors = 0, timeouts = 0;
    for (const o of outcomes) {
      if (o === 'approved' || o === 'declined') successes++;
      else if (o === 'error') errors++;
      else if (o === 'timeout') timeouts++;
    }
    const len = outcomes.length;
    return {
      successRate: successes / len,
      errorRate: errors / len,
      timeoutRate: timeouts / len,
    };
  }

  private updateStatus(s: AcquirerState): void {
    const rates = this.computeRates(s.recentOutcomes);
    const failRate = rates.errorRate + rates.timeoutRate;
    const prev = s.status;

    if (prev === 'healthy') {
      if (s.consecutiveFailures >= CONSECUTIVE_FAILURES_DOWN) {
        s.status = 'down';
      } else if (failRate > 0.3) {
        s.status = 'degraded';
      }
    } else if (prev === 'degraded') {
      if (s.consecutiveFailures >= CONSECUTIVE_FAILURES_DOWN || failRate > 0.5) {
        s.status = 'down';
      } else if (rates.successRate > 0.8 && s.consecutiveFailures === 0) {
        s.status = 'healthy';
      }
    } else if (prev === 'down') {
      if (s.consecutiveSuccesses >= CONSECUTIVE_SUCCESSES_RECOVERY) {
        s.status = 'degraded';
      }
    }
  }

  recordOutcome(acquirer: string, outcome: Outcome): void {
    const s = this.getOrCreateState(acquirer);

    // Update circular buffer
    s.recentOutcomes.push(outcome);
    if (s.recentOutcomes.length > WINDOW_SIZE) {
      s.recentOutcomes.shift();
    }

    // Update consecutive counters
    if (isFailure(outcome)) {
      s.consecutiveFailures++;
      s.consecutiveSuccesses = 0;
    } else if (isSuccess(outcome)) {
      s.consecutiveSuccesses++;
      s.consecutiveFailures = 0;
    }

    s.totalProcessed++;
    s.lastUpdated = new Date().toISOString();

    this.updateStatus(s);
  }

  getHealth(acquirer: string): HealthStatus {
    const s = this.getOrCreateState(acquirer);
    const rates = this.computeRates(s.recentOutcomes);
    return {
      acquirer,
      status: s.status,
      consecutiveFailures: s.consecutiveFailures,
      metrics: {
        successRate: Math.round(rates.successRate * 10000) / 10000,
        errorRate: Math.round(rates.errorRate * 10000) / 10000,
        timeoutRate: Math.round(rates.timeoutRate * 10000) / 10000,
        totalProcessed: s.totalProcessed,
      },
      lastUpdated: s.lastUpdated,
    };
  }

  getAllHealth(): Record<string, HealthStatus> {
    const result: Record<string, HealthStatus> = {};
    for (const acquirer of this.state.keys()) {
      result[acquirer] = this.getHealth(acquirer);
    }
    return result;
  }

  isAvailable(acquirer: string): boolean {
    const s = this.state.get(acquirer);
    if (!s) return true; // Unknown acquirers default to available
    return s.status !== 'down';
  }

  initializeFromHistory(transactions: Transaction[]): void {
    // Sort chronologically
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    for (const txn of sorted) {
      this.recordOutcome(txn.acquirer, txn.outcome);
    }
  }
}

export const healthMonitor = new HealthMonitor();
