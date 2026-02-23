import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { PaymentRequest, Transaction } from '../models/types';
import { RoutingEngine } from '../services/routing-engine';
import { FallbackSequencer } from '../services/fallback-sequencer';

export function createDemoRouter(routingEngine: RoutingEngine, fallbackSequencer: FallbackSequencer): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    // Load sample requests
    const samplesPath = path.resolve(__dirname, '../data/sample-requests.json');
    const samples: PaymentRequest[] = JSON.parse(fs.readFileSync(samplesPath, 'utf-8'));

    // Run each through routing engine
    const decisions = samples.map((req) => {
      const decision = routingEngine.route(req);
      const fallback = fallbackSequencer.getSequence(req, decision.selectedAcquirer);
      return {
        request: req,
        selectedAcquirer: decision.selectedAcquirer,
        justification: decision.justification,
        optimizationMode: decision.optimizationMode,
        scores: decision.scores,
        fallbackSequence: fallback,
      };
    });

    // Summary: per-acquirer counts and average scores
    const perAcquirer: Record<string, { count: number; totalScore: number }> = {};
    for (const d of decisions) {
      const acq = d.selectedAcquirer;
      if (!perAcquirer[acq]) perAcquirer[acq] = { count: 0, totalScore: 0 };
      perAcquirer[acq].count++;
      const selectedScore = d.scores.find(s => s.acquirer === acq);
      if (selectedScore) perAcquirer[acq].totalScore += selectedScore.totalScore;
    }
    const summary: Record<string, { count: number; avgScore: number }> = {};
    for (const [acq, data] of Object.entries(perAcquirer)) {
      summary[acq] = {
        count: data.count,
        avgScore: Math.round((data.totalScore / data.count) * 10000) / 10000,
      };
    }

    // Comparison: smart routing vs round-robin using historical data
    const historicalPath = path.resolve(__dirname, '../data/historical.json');
    const historical: Transaction[] = JSON.parse(fs.readFileSync(historicalPath, 'utf-8'));

    // Smart routing approval rate: use historical outcomes grouped by acquirer selected by smart routing
    // For each historical transaction, route it and check if the actual outcome for that acquirer was approved
    // Simplified: compute weighted approval rate from historical data per acquirer based on smart routing distribution
    const acquirerNames = ['A', 'B', 'C'];

    // Round-robin: cycle through acquirers
    let rrApproved = 0;
    let rrTotal = 0;
    for (let i = 0; i < historical.length; i++) {
      const assignedAcquirer = acquirerNames[i % acquirerNames.length];
      if (historical[i].acquirer === assignedAcquirer && historical[i].outcome === 'approved') {
        rrApproved++;
      }
      if (historical[i].acquirer === assignedAcquirer) {
        rrTotal++;
      }
    }
    // For a fairer comparison: compute round-robin rate as average of all acquirer approval rates
    const acquirerApprovalRates: Record<string, { approved: number; total: number }> = {};
    for (const tx of historical) {
      if (!acquirerApprovalRates[tx.acquirer]) acquirerApprovalRates[tx.acquirer] = { approved: 0, total: 0 };
      acquirerApprovalRates[tx.acquirer].total++;
      if (tx.outcome === 'approved') acquirerApprovalRates[tx.acquirer].approved++;
    }
    const acquirerRates = Object.values(acquirerApprovalRates);
    const roundRobinApprovalRate = acquirerRates.reduce((sum, a) => sum + a.approved, 0)
      / acquirerRates.reduce((sum, a) => sum + a.total, 0);

    // Smart routing: for each historical transaction, simulate smart routing and use best acquirer's rate
    let smartApproved = 0;
    for (const tx of historical) {
      const decision = routingEngine.route({
        amount: tx.amount,
        currency: tx.currency,
        cardType: tx.cardType,
        country: tx.country,
      });
      const selectedShort = decision.selectedAcquirer.replace('Acquirer ', '');
      // If smart routing would have picked this transaction's actual acquirer, use actual outcome
      // Otherwise estimate: use the selected acquirer's historical approval rate for this segment
      if (selectedShort === tx.acquirer) {
        if (tx.outcome === 'approved') smartApproved++;
      } else {
        // Use the selected acquirer's approval rate as probability
        const selectedScore = decision.scores.find(s => s.acquirer === decision.selectedAcquirer);
        if (selectedScore) smartApproved += selectedScore.approvalRate;
      }
    }
    const smartApprovalRate = smartApproved / historical.length;

    const liftPp = Math.round((smartApprovalRate - roundRobinApprovalRate) * 10000) / 100;
    const avgTxValue = historical.reduce((s, t) => s + t.amount, 0) / historical.length;
    const estimatedMonthlyTransactions = historical.length * 30;
    const estimatedMonthlyRevenueLift = Math.round(
      estimatedMonthlyTransactions * avgTxValue * (liftPp / 100) * 100
    ) / 100;

    res.json({
      decisions,
      summary: { perAcquirer: summary },
      comparison: {
        smartApprovalRate: Math.round(smartApprovalRate * 10000) / 10000,
        roundRobinApprovalRate: Math.round(roundRobinApprovalRate * 10000) / 10000,
        liftPp,
        estimatedMonthlyRevenueLift,
      },
    });
  });

  return router;
}

export default Router();
