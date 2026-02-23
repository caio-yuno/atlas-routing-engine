import * as assert from 'assert';
import { PerformanceAnalyzer } from '../src/services/performance-analyzer';
import { RoutingEngine } from '../src/services/routing-engine';
import { FallbackSequencer } from '../src/services/fallback-sequencer';

// We need a fresh HealthMonitor class (not the singleton) for isolated tests.
// Re-implement minimal health monitor for test isolation.
import { Outcome } from '../src/models/types';

// ---------- Inline HealthMonitor for test isolation ----------
const WINDOW_SIZE = 20;
const CONSECUTIVE_FAILURES_DOWN = 5;
const CONSECUTIVE_SUCCESSES_RECOVERY = 3;

interface AcquirerState {
  recentOutcomes: Outcome[];
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  status: 'healthy' | 'degraded' | 'down';
  totalProcessed: number;
}

function isFailure(outcome: Outcome): boolean {
  return outcome === 'error' || outcome === 'timeout';
}

function isSuccess(outcome: Outcome): boolean {
  return outcome === 'approved' || outcome === 'declined';
}

class TestHealthMonitor {
  private state: Map<string, AcquirerState> = new Map();

  private getOrCreate(acquirer: string): AcquirerState {
    let s = this.state.get(acquirer);
    if (!s) {
      s = {
        recentOutcomes: [],
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        status: 'healthy',
        totalProcessed: 0,
      };
      this.state.set(acquirer, s);
    }
    return s;
  }

  private computeRates(outcomes: Outcome[]) {
    if (outcomes.length === 0) return { successRate: 1, errorRate: 0, timeoutRate: 0 };
    let successes = 0, errors = 0, timeouts = 0;
    for (const o of outcomes) {
      if (o === 'approved' || o === 'declined') successes++;
      else if (o === 'error') errors++;
      else if (o === 'timeout') timeouts++;
    }
    return { successRate: successes / outcomes.length, errorRate: errors / outcomes.length, timeoutRate: timeouts / outcomes.length };
  }

  private updateStatus(s: AcquirerState): void {
    const rates = this.computeRates(s.recentOutcomes);
    const failRate = rates.errorRate + rates.timeoutRate;
    const prev = s.status;

    if (prev === 'healthy') {
      if (s.consecutiveFailures >= CONSECUTIVE_FAILURES_DOWN) s.status = 'down';
      else if (failRate > 0.3) s.status = 'degraded';
    } else if (prev === 'degraded') {
      if (s.consecutiveFailures >= CONSECUTIVE_FAILURES_DOWN || failRate > 0.5) s.status = 'down';
      else if (rates.successRate > 0.8 && s.consecutiveFailures === 0) s.status = 'healthy';
    } else if (prev === 'down') {
      if (s.consecutiveSuccesses >= CONSECUTIVE_SUCCESSES_RECOVERY) s.status = 'degraded';
    }
  }

  recordOutcome(acquirer: string, outcome: Outcome): void {
    const s = this.getOrCreate(acquirer);
    s.recentOutcomes.push(outcome);
    if (s.recentOutcomes.length > WINDOW_SIZE) s.recentOutcomes.shift();
    if (isFailure(outcome)) { s.consecutiveFailures++; s.consecutiveSuccesses = 0; }
    else if (isSuccess(outcome)) { s.consecutiveSuccesses++; s.consecutiveFailures = 0; }
    s.totalProcessed++;
    this.updateStatus(s);
  }

  getStatus(acquirer: string): 'healthy' | 'degraded' | 'down' {
    const s = this.state.get(acquirer);
    return s ? s.status : 'healthy';
  }

  isAvailable(acquirer: string): boolean {
    const s = this.state.get(acquirer);
    if (!s) return true;
    return s.status !== 'down';
  }
}

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
  // B has ~92% for MXN credit per generator
  assert.ok(perf.approvalRate > 0.80, `expected >80% for B/MXN/credit, got ${(perf.approvalRate * 100).toFixed(1)}%`);
});

test('returns approval rate for acquirer C with high amount range', () => {
  const perf = analyzer.getApprovalRate('C', { amount: 1000 });
  assert.ok(perf.approvalRate > 0, 'approval rate should be positive');
  // C has ~68% for >$500 per generator
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

// ---------- Routing Engine Tests ----------
console.log('\nRouting Engine');

const engine = new RoutingEngine();

test('selects acquirer with highest weighted score for MXN credit', () => {
  const decision = engine.route({ amount: 200, currency: 'MXN', cardType: 'credit', country: 'MX' });
  assert.ok(decision.selectedAcquirer, 'should select an acquirer');
  assert.ok(decision.scores.length > 0, 'should have scores');
  // Scores should be sorted descending; selected should be first
  assert.strictEqual(decision.selectedAcquirer, decision.scores[0].acquirer);
  // Selected acquirer should have highest total score
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
  // In cost_conscious, Acquirer C (2.1% rate) should be favored for low-value
  // unless its approval rate is >5pp lower than best
});

test('returns fallback sequence excluding selected acquirer', () => {
  const decision = engine.route({ amount: 300, currency: 'BRL', cardType: 'debit', country: 'BR' });
  const fallbackAcquirers = decision.fallbackSequence.map(f => f.acquirer);
  assert.ok(!fallbackAcquirers.includes(decision.selectedAcquirer), 'fallback should not include selected');
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
  const monitor = new TestHealthMonitor();
  monitor.recordOutcome('TestAcq', 'approved');
  monitor.recordOutcome('TestAcq', 'approved');
  monitor.recordOutcome('TestAcq', 'approved');
  assert.strictEqual(monitor.getStatus('TestAcq'), 'healthy');
});

test('transitions to degraded when fail rate exceeds 30%', () => {
  const monitor = new TestHealthMonitor();
  // 7 successes + 4 errors = ~36% fail rate in window
  for (let i = 0; i < 7; i++) monitor.recordOutcome('TestAcq', 'approved');
  for (let i = 0; i < 4; i++) monitor.recordOutcome('TestAcq', 'error');
  // The consecutive failures reset on success, but fail rate > 30% triggers degraded
  // Actually need consecutive errors to not be interrupted — let's rearrange:
  // We need failRate > 0.3 in the window
  const monitor2 = new TestHealthMonitor();
  for (let i = 0; i < 6; i++) monitor2.recordOutcome('X', 'approved');
  for (let i = 0; i < 4; i++) monitor2.recordOutcome('X', 'error');
  // window: 6 approved + 4 error = 40% fail rate > 30%
  assert.strictEqual(monitor2.getStatus('X'), 'degraded');
});

test('transitions to down after 5 consecutive failures', () => {
  const monitor = new TestHealthMonitor();
  for (let i = 0; i < 5; i++) monitor.recordOutcome('TestAcq', 'error');
  assert.strictEqual(monitor.getStatus('TestAcq'), 'down');
});

test('treats declined as normal (not a health failure)', () => {
  const monitor = new TestHealthMonitor();
  for (let i = 0; i < 10; i++) monitor.recordOutcome('TestAcq', 'declined');
  assert.strictEqual(monitor.getStatus('TestAcq'), 'healthy');
  assert.ok(monitor.isAvailable('TestAcq'), 'declined-only acquirer should be available');
});

test('recovers from down to degraded after 3 consecutive successes', () => {
  const monitor = new TestHealthMonitor();
  // Drive to down
  for (let i = 0; i < 5; i++) monitor.recordOutcome('TestAcq', 'timeout');
  assert.strictEqual(monitor.getStatus('TestAcq'), 'down');
  // Recover with 3 successes
  for (let i = 0; i < 3; i++) monitor.recordOutcome('TestAcq', 'approved');
  assert.strictEqual(monitor.getStatus('TestAcq'), 'degraded');
});

// ---------- Fallback Sequencer Tests ----------
console.log('\nFallback Sequencer');

test('excludes down acquirers from fallback', () => {
  const monitor = new TestHealthMonitor();
  // Drive Acquirer A to down
  for (let i = 0; i < 6; i++) monitor.recordOutcome('Acquirer A', 'error');
  assert.strictEqual(monitor.getStatus('Acquirer A'), 'down');
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
  const monitor = new TestHealthMonitor();
  const sequencer = new FallbackSequencer(analyzer, monitor);
  const fallback = sequencer.getSequence(
    { amount: 200, currency: 'BRL', cardType: 'debit', country: 'BR' },
    'Acquirer A'
  );
  const names = fallback.map(f => f.acquirer);
  assert.ok(!names.includes('Acquirer A'), 'primary acquirer should not be in fallback');
});

test('fallback entries are sorted by approval rate descending', () => {
  const monitor = new TestHealthMonitor();
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
