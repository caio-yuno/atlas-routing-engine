import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { Transaction } from './models/types';
import { PerformanceAnalyzer } from './services/performance-analyzer';
import { healthMonitor } from './services/health-monitor';
import { RoutingEngine } from './services/routing-engine';
import { FallbackSequencer } from './services/fallback-sequencer';
import { createPaymentsRouter } from './routes/payments';
import { createDemoRouter } from './routes/demo';
import healthRouter from './routes/health';

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize services with dependency injection
const performanceAnalyzer = new PerformanceAnalyzer();

// Load historical data and initialize health monitor
const historicalPath = path.resolve(__dirname, 'data/historical.json');
const historicalData: Transaction[] = JSON.parse(fs.readFileSync(historicalPath, 'utf-8'));
healthMonitor.initializeFromHistory(historicalData);

// Inject dependencies into routing engine
const routingEngine = new RoutingEngine(performanceAnalyzer, healthMonitor);
const fallbackSequencer = new FallbackSequencer(performanceAnalyzer, healthMonitor);

// Wire routes
app.use('/api/route', createPaymentsRouter(routingEngine, fallbackSequencer));
app.use('/api/health', healthRouter);
app.use('/api/demo', createDemoRouter(routingEngine, fallbackSequencer));

app.get('/', (_req, res) => {
  res.json({
    name: 'Atlas Commerce Smart Routing Engine',
    version: '1.0.0',
    endpoints: ['/api/route', '/api/health', '/api/demo'],
  });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Atlas Routing Engine running on port ${PORT}`);
});

export default app;
