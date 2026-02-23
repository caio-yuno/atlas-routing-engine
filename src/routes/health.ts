import { Router, Request, Response } from 'express';
import { HealthMonitor } from '../services/health-monitor';

export function createHealthRouter(healthMonitor: HealthMonitor): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(healthMonitor.getAllHealth());
  });

  router.get('/:acquirer', (req: Request, res: Response) => {
    const { acquirer } = req.params;
    const health = healthMonitor.getHealth(acquirer);
    res.json(health);
  });

  return router;
}
