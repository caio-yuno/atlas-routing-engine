import * as assert from 'assert';
import { PerformanceAnalyzer } from '../src/services/performance-analyzer';
import { RoutingEngine, HealthProvider } from '../src/services/routing-engine';
import { HealthMonitor } from '../src/services/health-monitor';
import { FallbackSequencer } from '../src/services/fallback-sequencer';
import { HealthStatus } from '../src/models/types';

// ---------- Test runner ----------
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

console.log('\nAtlas Routing Engine — Test Suite\n');

// ---------- Performance Analyzer Tests ----------
console.log('Performance Analyzer');

const analyzer = new PerformanceAnalyzer();

test('returns approval rate for acquirer B with MXN/credit segment', () => {
  const perf = analyzer.getApprovalRate('B', { currency: 'MXN', cardType: 'credit' });
  assert.ok(perf.approvalRate > 0, 'approval rate should be positive');
  assert.ok(perf.sampleSize > 0, 'sample size should be positive');
  assert.ok(perf.approvalRate > 0.70, `expected >70% for B/MXN/credit, got ${(perf.approvalRate * 100).toFixed(1)}%`);
});

test('returns approval rate for acquirer C with high amount range', () => {
  const perf = analyzer.getApprovalRate('C', { amount: 1000 });
  assert.ok(perf.approvalRate > 0, 'approval rate should be positive');
  assert.ok(perf.approvalRate < 0.85, `expected <85% for C high-value, got ${(perf.approvalRate * 100).toFixed(1)}%`);
});

test('returns baseline when no filters match', () => {
  const perf = analyzer.getApprovalRate('A', {});
  assert.ok(perf.sampleSize > 0, 'baseline should have samples');
  assert.strictEqual(perf.segment, 'overall');
});

test('returns zero for unknown acquirer', () => {
  const perf = analyzer.getApprovalRate('Z', {});
  assert.strictEqual(perf.approvalRate, 0);
  assert.strictEqual(perf.sampleSize, 0);
});

test('blends multiple segment dimensions', () => {
  // When providing multiple filters, the result should blend them
  const blended = analyzer.getApprovalRate('A', { currency: 'MXN', cardType: 'credit', country: 'MX', amount: 200 });
  const baseline = analyzer.getApprovalRate('A', {});
  // Blended should have a larger sample size than baseline (sums across segments)
  assert.ok(blended.sampleSize > baseline.sampleSize, 'blended should aggregate sample sizes');
  // Segment label should contain multiple dimensions
  assert.ok(blended.segment.includes('+'), `expected blended segment label, got "${blended.segment}"`);
});

// ---------- Routing Engine Tests ----------
console.log('\nRouting Engine');

const testHealthProvider: HealthProvider = {
  getHealth: (acq: string): HealthStatus => ({
    acquirer: acq,
    status: 'healthy',
    consecutiveFailures: 0,
    metrics: { successRate: 1, errorRate: 0, timeoutRate: 0, totalProcessed: 0 },
    lastUpdated: new Date().toISOString(),
  }),
  isAvailable: () => true,
};

const engine = new RoutingEngine(analyzer, testHealthProvider);

test('selects acquirer with highest weighted score for MXN credit', () => {
  const decision = engine.route({ amount: 200, currency: 'MXN', cardType: 'credit', country: 'MX' });
  assert.ok(decision.selectedAcquirer, 'should select an acquirer');
  assert.ok(decision.scores.length > 0, 'should have scores');
  assert.strictEqual(decision.selectedAcquirer, decision.scores[0].acquirer);
  const maxScore = Math.max(...decision.scores.map(s => s.totalScore));
  assert.strictEqual(decision.scores[0].totalScore, maxScore);
});

test('selects cheapest viable acquirer in cost_conscious mode for low value', () => {
  const decision = engine.route({
    amount: 50,
    currency: 'USD',
    cardType: 'credit',
    country: 'US',
    optimizationMode: 'cost_conscious',
  });
  assert.ok(decision.selectedAcquirer, 'should select an acquirer');
  assert.strictEqual(decision.optimizationMode, 'cost_conscious');
});

test('returns NONE when all acquirers are down', () => {
  const allDownProvider: HealthProvider = {
    getHealth: (acq: string): HealthStatus => ({
      acquirer: acq,
      status: 'down',
      consecutiveFailures: 10,
      metrics: { successRate: 0, errorRate: 1, timeoutRate: 0, totalProcessed: 100 },
      lastUpdated: new Date().toISOString(),
    }),
    isAvailable: () => false,
  };
  const downEngine = new RoutingEngine(analyzer, allDownProvider);
  const decision = downEngine.route({ amount: 100, currency: 'MXN', cardType: 'credit', country: 'MX' });
  assert.strictEqual(decision.selectedAcquirer, 'NONE');
  assert.strictEqual(decision.scores.length, 0);
  assert.ok(decision.justification.includes('No acquirers available'));
});

test('justification includes optimization mode', () => {
  const decision = engine.route({
    amount: 100,
    currency: 'MXN',
    cardType: 'credit',
    country: 'MX',
    optimizationMode: 'maximize_approvals',
  });
  assert.ok(decision.justification.includes('maximize_approvals'), 'justification should mention mode');
});

// ---------- Health Monitor Tests ----------
console.log('\nHealth Monitor');

test('starts healthy and stays healthy with approved outcomes', () => {
  const monitor = new HealthMonitor();
  monitor.recordOutcome('TestAcq', 'approved');
  monitor.recordOutcome('TestAcq', 'approved');
  monitor.recordOutcome('TestAcq', 'approved');
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'healthy');
});

test('transitions to degraded when fail rate exceeds 30%', () => {
  const monitor = new HealthMonitor();
  for (let i = 0; i < 6; i++) monitor.recordOutcome('X', 'approved');
  for (let i = 0; i < 4; i++) monitor.recordOutcome('X', 'error');
  // window: 6 approved + 4 error = 40% fail rate > 30%
  assert.strictEqual(monitor.getHealth('X').status, 'degraded');
});

test('transitions to down after 5 consecutive failures', () => {
  const monitor = new HealthMonitor();
  for (let i = 0; i < 5; i++) monitor.recordOutcome('TestAcq', 'error');
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'down');
});

test('treats declined as normal (not a health failure)', () => {
  const monitor = new HealthMonitor();
  for (let i = 0; i < 10; i++) monitor.recordOutcome('TestAcq', 'declined');
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'healthy');
  assert.ok(monitor.isAvailable('TestAcq'), 'declined-only acquirer should be available');
});

test('recovers from down to degraded after 3 consecutive successes', () => {
  const monitor = new HealthMonitor();
  for (let i = 0; i < 5; i++) monitor.recordOutcome('TestAcq', 'timeout');
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'down');
  for (let i = 0; i < 3; i++) monitor.recordOutcome('TestAcq', 'approved');
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'degraded');
});

test('reset clears all state', () => {
  const monitor = new HealthMonitor();
  for (let i = 0; i < 5; i++) monitor.recordOutcome('TestAcq', 'error');
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'down');
  monitor.reset();
  assert.strictEqual(monitor.getHealth('TestAcq').status, 'healthy');
});

// ---------- Fallback Sequencer Tests ----------
console.log('\nFallback Sequencer');

test('excludes down acquirers from fallback', () => {
  const monitor = new HealthMonitor();
  for (let i = 0; i < 6; i++) monitor.recordOutcome('Acquirer A', 'error');
  assert.strictEqual(monitor.getHealth('Acquirer A').status, 'down');
  assert.ok(!monitor.isAvailable('Acquirer A'));

  const sequencer = new FallbackSequencer(analyzer, monitor);
  const fallback = sequencer.getSequence(
    { amount: 200, currency: 'MXN', cardType: 'credit', country: 'MX' },
    'Acquirer B'
  );
  const names = fallback.map(f => f.acquirer);
  assert.ok(!names.includes('Acquirer A'), 'Acquirer A should be excluded (down)');
});

test('excludes primary acquirer from fallback', () => {
  const monitor = new HealthMonitor();
  const sequencer = new FallbackSequencer(analyzer, monitor);
  const fallback = sequencer.getSequence(
    { amount: 200, currency: 'BRL', cardType: 'debit', country: 'BR' },
    'Acquirer A'
  );
  const names = fallback.map(f => f.acquirer);
  assert.ok(!names.includes('Acquirer A'), 'primary acquirer should not be in fallback');
});

test('fallback entries are sorted by approval rate descending', () => {
  const monitor = new HealthMonitor();
  const sequencer = new FallbackSequencer(analyzer, monitor);
  const fallback = sequencer.getSequence(
    { amount: 100, currency: 'USD', cardType: 'credit', country: 'US' },
    'Acquirer A'
  );
  for (let i = 1; i < fallback.length; i++) {
    assert.ok(
      fallback[i - 1].expectedApprovalRate >= fallback[i].expectedApprovalRate,
      'fallback should be sorted by approval rate desc'
    );
  }
});

// ---------- Summary ----------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!\n');
}
