import { Router, Request, Response } from 'express';
import { healthMonitor } from '../services/health-monitor';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(healthMonitor.getAllHealth());
});

router.get('/:acquirer', (req: Request, res: Response) => {
  const { acquirer } = req.params;
  const health = healthMonitor.getHealth(acquirer);
  res.json(health);
});

export default router;
