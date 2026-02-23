import { PaymentRequest, FallbackEntry } from '../models/types';
import { acquirers } from '../config/acquirers';
import { PerformanceAnalyzer } from './performance-analyzer';

interface HealthChecker {
  isAvailable(acquirer: string): boolean;
}

export class FallbackSequencer {
  constructor(
    private performanceAnalyzer: PerformanceAnalyzer,
    private healthChecker: HealthChecker
  ) {}

  getSequence(request: PaymentRequest, primaryAcquirer: string): FallbackEntry[] {
    const candidates: { acquirer: string; approvalRate: number }[] = [];

    for (const acq of acquirers) {
      if (!acq.enabled) continue;
      if (acq.name === primaryAcquirer) continue;
      if (!this.healthChecker.isAvailable(acq.name)) continue;

      // Check both full name and short name (historical data uses "A", "B", "C")
      const shortName = acq.name.replace('Acquirer ', '');
      const perfFull = this.performanceAnalyzer.getApprovalRate(acq.name, {
        currency: request.currency,
        cardType: request.cardType,
        country: request.country,
        amount: request.amount,
      });
      const perfShort = this.performanceAnalyzer.getApprovalRate(shortName, {
        currency: request.currency,
        cardType: request.cardType,
        country: request.country,
        amount: request.amount,
      });

      const best = perfShort.sampleSize > perfFull.sampleSize ? perfShort : perfFull;

      if (best.approvalRate >= 0.5) {
        candidates.push({ acquirer: acq.name, approvalRate: best.approvalRate });
      }
    }

    // Sort by approval rate descending
    candidates.sort((a, b) => b.approvalRate - a.approvalRate);

    // Return top 2-3 fallbacks
    return candidates.slice(0, 3).map((c, i) => ({
      acquirer: c.acquirer,
      expectedApprovalRate: c.approvalRate,
      reason: i === 0
        ? `Secondary: next highest approval rate (${(c.approvalRate * 100).toFixed(0)}%) for this transaction type`
        : `Tertiary: available with ${(c.approvalRate * 100).toFixed(0)}% approval rate`,
    }));
  }
}
