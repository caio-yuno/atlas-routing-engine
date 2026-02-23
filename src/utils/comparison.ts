import * as path from 'path';
import * as fs from 'fs';
import { Transaction, PaymentRequest } from '../models/types';
import { RoutingEngine } from '../services/routing-engine';

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

export function runComparison(): ComparisonResult {
  const historicalPath = path.resolve(__dirname, '../data/historical.json');
  const historical: Transaction[] = JSON.parse(fs.readFileSync(historicalPath, 'utf-8'));
  const routingEngine = new RoutingEngine();

  const acquirerNames = ['A', 'B', 'C'];

  // --- Round-robin simulation ---
  // Average approval rate across all acquirers (equal distribution)
  const acquirerStats: Record<string, { approved: number; total: number }> = {};
  for (const tx of historical) {
    if (!acquirerStats[tx.acquirer]) acquirerStats[tx.acquirer] = { approved: 0, total: 0 };
    acquirerStats[tx.acquirer].total++;
    if (tx.outcome === 'approved') acquirerStats[tx.acquirer].approved++;
  }
  const totalApproved = Object.values(acquirerStats).reduce((s, a) => s + a.approved, 0);
  const totalTx = Object.values(acquirerStats).reduce((s, a) => s + a.total, 0);
  const roundRobinApprovalRate = totalApproved / totalTx;

  // --- Smart routing simulation ---
  let smartApproved = 0;
  const routingDistribution: Record<string, number> = {};

  // Segment tracking
  type SegKey = string;
  const segmentSmart: Record<SegKey, { approved: number; total: number }> = {};
  const segmentRR: Record<SegKey, { approved: number; total: number }> = {};

  for (let i = 0; i < historical.length; i++) {
    const tx = historical[i];
    const request: PaymentRequest = {
      amount: tx.amount,
      currency: tx.currency,
      cardType: tx.cardType,
      country: tx.country,
    };

    const decision = routingEngine.route(request);
    const selectedShort = decision.selectedAcquirer.replace('Acquirer ', '');

    // Track distribution
    routingDistribution[decision.selectedAcquirer] = (routingDistribution[decision.selectedAcquirer] || 0) + 1;

    // Segment keys
    const currSeg = `currency:${tx.currency}`;
    const cardSeg = `cardType:${tx.cardType}`;
    const amtSeg = `amount:${tx.amount <= 100 ? 'low' : tx.amount <= 500 ? 'mid' : 'high'}`;

    const segments = [currSeg, cardSeg, amtSeg];

    // Smart routing: if the engine picks the same acquirer, use actual outcome
    // Otherwise, use the selected acquirer's historical approval rate as estimate
    if (selectedShort === tx.acquirer) {
      const approved = tx.outcome === 'approved' ? 1 : 0;
      smartApproved += approved;
      for (const seg of segments) {
        if (!segmentSmart[seg]) segmentSmart[seg] = { approved: 0, total: 0 };
        segmentSmart[seg].total++;
        segmentSmart[seg].approved += approved;
      }
    } else {
      const selectedScore = decision.scores.find(s => s.acquirer === decision.selectedAcquirer);
      const rate = selectedScore ? selectedScore.approvalRate : 0;
      smartApproved += rate;
      for (const seg of segments) {
        if (!segmentSmart[seg]) segmentSmart[seg] = { approved: 0, total: 0 };
        segmentSmart[seg].total++;
        segmentSmart[seg].approved += rate;
      }
    }

    // Round-robin segment tracking: use actual outcome
    const rrAcquirer = acquirerNames[i % acquirerNames.length];
    const rrApproved = (tx.acquirer === rrAcquirer && tx.outcome === 'approved') ? 1 :
                       (tx.acquirer !== rrAcquirer) ? (acquirerStats[rrAcquirer]?.approved ?? 0) / (acquirerStats[rrAcquirer]?.total ?? 1) : 0;
    for (const seg of segments) {
      if (!segmentRR[seg]) segmentRR[seg] = { approved: 0, total: 0 };
      segmentRR[seg].total++;
      segmentRR[seg].approved += rrApproved;
    }
  }

  const smartApprovalRate = smartApproved / historical.length;
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
  for (const seg of Object.keys(segmentSmart)) {
    const smart = segmentSmart[seg];
    const rr = segmentRR[seg];
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
