import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { PaymentRequest } from '../models/types';
import { RoutingEngine } from '../services/routing-engine';
import { FallbackSequencer } from '../services/fallback-sequencer';
import { runComparison } from '../utils/comparison';

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

    // True counterfactual comparison
    const comparison = runComparison();

    res.json({
      decisions,
      summary: { perAcquirer: summary },
      comparison: {
        smartApprovalRate: comparison.smartApprovalRate,
        roundRobinApprovalRate: comparison.roundRobinApprovalRate,
        liftPp: comparison.liftPp,
        estimatedMonthlyRevenueLift: comparison.estimatedMonthlyRevenueLift,
        perAcquirerDistribution: comparison.perAcquirerDistribution,
        perSegmentImprovements: comparison.perSegmentImprovements,
      },
    });
  });

  return router;
}

