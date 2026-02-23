import { Router, Request, Response } from 'express';
import { PaymentRequest, Currency, CardType, Country, OptimizationMode } from '../models/types';
import { RoutingEngine } from '../services/routing-engine';
import { FallbackSequencer } from '../services/fallback-sequencer';

const VALID_CURRENCIES: Currency[] = ['MXN', 'BRL', 'USD'];
const VALID_CARD_TYPES: CardType[] = ['credit', 'debit'];
const VALID_COUNTRIES: Country[] = ['MX', 'BR', 'US'];
const VALID_MODES: OptimizationMode[] = ['maximize_approvals', 'balanced', 'cost_conscious'];

export function createPaymentsRouter(routingEngine: RoutingEngine, fallbackSequencer: FallbackSequencer): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const { amount, currency, cardType, country, optimizationMode } = req.body;

    // Validate required fields
    const errors: string[] = [];

    if (amount === undefined || amount === null || typeof amount !== 'number' || amount <= 0) {
      errors.push('amount must be a positive number');
    }
    if (!currency || !VALID_CURRENCIES.includes(currency)) {
      errors.push(`currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
    }
    if (!cardType || !VALID_CARD_TYPES.includes(cardType)) {
      errors.push(`cardType must be one of: ${VALID_CARD_TYPES.join(', ')}`);
    }
    if (!country || !VALID_COUNTRIES.includes(country)) {
      errors.push(`country must be one of: ${VALID_COUNTRIES.join(', ')}`);
    }
    if (optimizationMode && !VALID_MODES.includes(optimizationMode)) {
      errors.push(`optimizationMode must be one of: ${VALID_MODES.join(', ')}`);
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    const request: PaymentRequest = { amount, currency, cardType, country, optimizationMode };
    const decision = routingEngine.route(request);
    const fallbackSequence = fallbackSequencer.getSequence(request, decision.selectedAcquirer);

    res.json({
      selectedAcquirer: decision.selectedAcquirer,
      scores: decision.scores,
      justification: decision.justification,
      optimizationMode: decision.optimizationMode,
      fallbackSequence,
    });
  });

  return router;
}

