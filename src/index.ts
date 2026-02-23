import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { Transaction } from './models/types';
import { PerformanceAnalyzer } from './services/performance-analyzer';
import { HealthMonitor } from './services/health-monitor';
import { RoutingEngine } from './services/routing-engine';
import { FallbackSequencer } from './services/fallback-sequencer';
import { createPaymentsRouter } from './routes/payments';
import { createHealthRouter } from './routes/health';
import { createDemoRouter } from './routes/demo';

const app = express();
const PORT = 3000;

app.use(express.json());

// Load historical data
const historicalPath = path.resolve(__dirname, 'data/historical.json');
let historicalData: Transaction[] = [];
try {
  historicalData = JSON.parse(fs.readFileSync(historicalPath, 'utf-8'));
} catch {
  console.error(`Warning: Could not load ${historicalPath}. Run 'npm run generate' first.`);
}

// Initialize all services with dependency injection
const performanceAnalyzer = new PerformanceAnalyzer(historicalData);
const healthMonitor = new HealthMonitor();
healthMonitor.initializeFromHistory(historicalData);
const routingEngine = new RoutingEngine(performanceAnalyzer, healthMonitor);
const fallbackSequencer = new FallbackSequencer(performanceAnalyzer, healthMonitor);

// Wire routes — all use DI, no singleton imports
app.use('/api/route', createPaymentsRouter(routingEngine, fallbackSequencer));
app.use('/api/health', createHealthRouter(healthMonitor));
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
