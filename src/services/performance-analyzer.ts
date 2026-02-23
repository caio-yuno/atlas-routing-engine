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

  getApprovalRate(acquirer: string, filters: ApprovalFilters): AcquirerPerformance {
    // Try most specific segment first, fall back to less specific ones.
    // Priority: combined > single-dimension > baseline

    // 1. Acquirer x Currency x CardType (most specific combined key)
    if (filters.currency && filters.cardType) {
      const seg = this.getSegment(`${acquirer}:currency:${filters.currency}:cardType:${filters.cardType}`);
      if (seg && seg.sampleSize >= 5) {
        return {
          acquirer,
          approvalRate: seg.rate,
          sampleSize: seg.sampleSize,
          segment: `${filters.currency}/${filters.cardType}`,
        };
      }
    }

    // 2. Single-dimension segments — pick the one with best specificity (smallest sample is more targeted)
    const candidates: { rate: number; sampleSize: number; segment: string }[] = [];

    if (filters.currency) {
      const seg = this.getSegment(`${acquirer}:currency:${filters.currency}`);
      if (seg && seg.sampleSize >= 5) {
        candidates.push({ ...seg, segment: filters.currency });
      }
    }

    if (filters.cardType) {
      const seg = this.getSegment(`${acquirer}:cardType:${filters.cardType}`);
      if (seg && seg.sampleSize >= 5) {
        candidates.push({ ...seg, segment: filters.cardType });
      }
    }

    if (filters.country) {
      const seg = this.getSegment(`${acquirer}:country:${filters.country}`);
      if (seg && seg.sampleSize >= 5) {
        candidates.push({ ...seg, segment: filters.country });
      }
    }

    if (filters.amount !== undefined) {
      const range = getAmountRange(filters.amount);
      const seg = this.getSegment(`${acquirer}:amountRange:${range}`);
      if (seg && seg.sampleSize >= 5) {
        candidates.push({ ...seg, segment: `amount:${range}` });
      }
    }

    // Pick the candidate with the smallest sample size (most specific segment)
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.sampleSize - b.sampleSize);
      const best = candidates[0];
      return {
        acquirer,
        approvalRate: best.rate,
        sampleSize: best.sampleSize,
        segment: best.segment,
      };
    }

    // 3. Baseline acquirer-level rate
    const baseline = this.getSegment(acquirer);
    if (baseline) {
      return {
        acquirer,
        approvalRate: baseline.rate,
        sampleSize: baseline.sampleSize,
        segment: 'overall',
      };
    }

    // No data at all for this acquirer
    return {
      acquirer,
      approvalRate: 0,
      sampleSize: 0,
      segment: 'none',
    };
  }
}

export const performanceAnalyzer = new PerformanceAnalyzer();
