import * as path from 'path';
import * as fs from 'fs';
import { Transaction, AcquirerPerformance } from '../models/types';

interface SegmentStats {
  approved: number;
  total: number;
}

interface ApprovalFilters {
  currency?: string;
  cardType?: string;
  country?: string;
  amount?: number;
}

function getAmountRange(amount: number): string {
  if (amount <= 100) return 'low';
  if (amount <= 500) return 'mid';
  return 'high';
}

export class PerformanceAnalyzer {
  private segments: Map<string, SegmentStats> = new Map();
  private transactions: Transaction[] = [];

  constructor() {
    this.loadAndCompute();
  }

  private loadAndCompute(): void {
    const dataPath = path.resolve(__dirname, '../data/historical.json');
    const raw = fs.readFileSync(dataPath, 'utf-8');
    this.transactions = JSON.parse(raw) as Transaction[];

    for (const tx of this.transactions) {
      const isApproved = tx.outcome === 'approved' ? 1 : 0;
      const amountRange = getAmountRange(tx.amount);

      // Acquirer-level baseline
      this.addToSegment(`${tx.acquirer}`, isApproved);

      // Acquirer x Currency
      this.addToSegment(`${tx.acquirer}:currency:${tx.currency}`, isApproved);

      // Acquirer x CardType
      this.addToSegment(`${tx.acquirer}:cardType:${tx.cardType}`, isApproved);

      // Acquirer x Country
      this.addToSegment(`${tx.acquirer}:country:${tx.country}`, isApproved);

      // Acquirer x AmountRange
      this.addToSegment(`${tx.acquirer}:amountRange:${amountRange}`, isApproved);

      // Acquirer x Currency x CardType (combined)
      this.addToSegment(`${tx.acquirer}:currency:${tx.currency}:cardType:${tx.cardType}`, isApproved);
    }
  }

  private addToSegment(key: string, approved: number): void {
    const existing = this.segments.get(key) || { approved: 0, total: 0 };
    existing.approved += approved;
    existing.total += 1;
    this.segments.set(key, existing);
  }

  private getSegment(key: string): { rate: number; sampleSize: number } | null {
    const stats = this.segments.get(key);
    if (!stats || stats.total === 0) return null;
    return { rate: stats.approved / stats.total, sampleSize: stats.total };
  }

  /**
   * Returns a blended approval rate that combines multiple segment dimensions.
   *
   * Instead of picking a single "best" segment, we blend all matching segments
   * using a weighted average. More specific segments (smaller sample size relative
   * to baseline, combined keys) receive higher weights:
   *
   *   - Combined (currency x cardType): weight 4
   *   - Single-dimension segments: weight 2
   *   - Baseline: weight 1
   *
   * This produces a more robust estimate that incorporates signals from all
   * relevant dimensions (e.g., both the currency effect and the amount-range
   * effect) rather than discarding all but one.
   */
  getApprovalRate(acquirer: string, filters: ApprovalFilters): AcquirerPerformance {
    const MIN_SAMPLE = 5;
    const candidates: { rate: number; sampleSize: number; segment: string; weight: number }[] = [];

    // 1. Combined key: Acquirer x Currency x CardType (highest weight)
    if (filters.currency && filters.cardType) {
      const seg = this.getSegment(`${acquirer}:currency:${filters.currency}:cardType:${filters.cardType}`);
      if (seg && seg.sampleSize >= MIN_SAMPLE) {
        candidates.push({ ...seg, segment: `${filters.currency}/${filters.cardType}`, weight: 4 });
      }
    }

    // 2. Single-dimension segments (medium weight)
    if (filters.currency) {
      const seg = this.getSegment(`${acquirer}:currency:${filters.currency}`);
      if (seg && seg.sampleSize >= MIN_SAMPLE) {
        candidates.push({ ...seg, segment: filters.currency, weight: 2 });
      }
    }

    if (filters.cardType) {
      const seg = this.getSegment(`${acquirer}:cardType:${filters.cardType}`);
      if (seg && seg.sampleSize >= MIN_SAMPLE) {
        candidates.push({ ...seg, segment: filters.cardType, weight: 2 });
      }
    }

    if (filters.country) {
      const seg = this.getSegment(`${acquirer}:country:${filters.country}`);
      if (seg && seg.sampleSize >= MIN_SAMPLE) {
        candidates.push({ ...seg, segment: filters.country, weight: 2 });
      }
    }

    if (filters.amount !== undefined) {
      const range = getAmountRange(filters.amount);
      const seg = this.getSegment(`${acquirer}:amountRange:${range}`);
      if (seg && seg.sampleSize >= MIN_SAMPLE) {
        candidates.push({ ...seg, segment: `amount:${range}`, weight: 2 });
      }
    }

    // 3. Baseline (lowest weight)
    const baseline = this.getSegment(acquirer);
    if (baseline && baseline.sampleSize >= MIN_SAMPLE) {
      candidates.push({ ...baseline, segment: 'overall', weight: 1 });
    }

    // No data at all
    if (candidates.length === 0) {
      return {
        acquirer,
        approvalRate: 0,
        sampleSize: 0,
        segment: 'none',
      };
    }

    // If only baseline, return it directly
    if (candidates.length === 1) {
      const c = candidates[0];
      return {
        acquirer,
        approvalRate: c.rate,
        sampleSize: c.sampleSize,
        segment: c.segment,
      };
    }

    // Blend all matching segments using weighted average
    let weightedSum = 0;
    let totalWeight = 0;
    let totalSampleSize = 0;
    const segmentLabels: string[] = [];

    for (const c of candidates) {
      weightedSum += c.rate * c.weight;
      totalWeight += c.weight;
      totalSampleSize += c.sampleSize;
      if (c.segment !== 'overall') {
        segmentLabels.push(c.segment);
      }
    }

    const blendedRate = weightedSum / totalWeight;
    const segmentLabel = segmentLabels.length > 0 ? segmentLabels.join('+') : 'overall';

    return {
      acquirer,
      approvalRate: blendedRate,
      sampleSize: totalSampleSize,
      segment: segmentLabel,
    };
  }
}

export const performanceAnalyzer = new PerformanceAnalyzer();
