# Atlas Commerce Smart Routing Engine

A payment routing engine that intelligently selects the best acquirer for each transaction based on historical performance, real-time health monitoring, and configurable optimization modes. Built to demonstrate how smart routing can meaningfully improve approval rates over naive round-robin distribution.

## Problem Statement

Atlas Commerce processes payments through multiple acquirers (A, B, C), each with different strengths:

- **Acquirer A** (2.8% take rate) -- General purpose, strong overall approval rates (~85%), but subject to occasional outages
- **Acquirer B** (3.1% take rate) -- Excellent for MXN credit cards (~92%), more expensive
- **Acquirer C** (2.1% take rate) -- Cheapest option, strong for low-value transactions (~89%), weaker for high-value (~68%)

Round-robin routing ignores these patterns. Smart routing exploits them to lift approval rates by **+7.15 percentage points**, translating to an estimated **$107,250/month** in additional revenue.

## Quick Start

```bash
npm install
npm run generate   # Generate 1000 historical transactions + 30 sample requests
npm run dev        # Start server on port 3000
```

To run the full demo:

```bash
bash scripts/demo.sh
```

To run tests:

```bash
npm run test
```

## API Endpoints

### POST /api/route

Route a payment request to the optimal acquirer.

```bash
curl -s -X POST http://localhost:3000/api/route \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 200,
    "currency": "MXN",
    "cardType": "credit",
    "country": "MX"
  }' | jq .
```

**Request body:**

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `amount` | number | Yes | Positive number |
| `currency` | string | Yes | `MXN`, `BRL`, `USD` |
| `cardType` | string | Yes | `credit`, `debit` |
| `country` | string | Yes | `MX`, `BR`, `US` |
| `optimizationMode` | string | No | `maximize_approvals`, `balanced` (default), `cost_conscious` |

**Response:** Routing decision with selected acquirer, all acquirer scores, justification, and fallback sequence.

### GET /api/health

Get real-time health status for all acquirers.

```bash
curl -s http://localhost:3000/api/health | jq .
```

Returns per-acquirer health with sliding window metrics: success rate, error rate, timeout rate, consecutive failures, and status (healthy/degraded/down).

### GET /api/demo

Run all 30 sample requests through the routing engine and return a comparison analysis.

```bash
curl -s http://localhost:3000/api/demo | jq .comparison
```

## Routing Algorithm

### Multi-Factor Weighted Scoring

Each acquirer receives a composite score:

```
totalScore = (weight_approval * approvalRateScore)
           + (weight_health  * healthScore)
           + (weight_cost    * costScore)
```

Where:
- **approvalRateScore** = Historical approval rate for the transaction's segment
- **healthScore** = 1.0 (healthy), 0.3 (degraded), 0.0 (down)
- **costScore** = 1 - (takeRate / maxTakeRate)

### Optimization Modes

| Mode | Approval Weight | Health Weight | Cost Weight |
|------|:-:|:-:|:-:|
| `maximize_approvals` | 0.80 | 0.15 | 0.05 |
| `balanced` | 0.60 | 0.25 | 0.15 |
| `cost_conscious` | 0.40 | 0.20 | 0.40 |

In `cost_conscious` mode, a safety override prevents selecting the cheapest acquirer if its approval rate is more than 5 percentage points lower than the best alternative.

### Segmented Historical Analysis

The performance analyzer computes approval rates at multiple granularities, preferring the most specific segment with sufficient data (minimum 5 samples):

1. **Combined:** Acquirer x Currency x CardType (e.g., "B for MXN credit")
2. **Single-dimension:** Acquirer x Currency, Acquirer x CardType, Acquirer x Country, Acquirer x AmountRange
3. **Baseline:** Acquirer overall rate

Amount ranges: low (0-100), mid (100-500), high (500+).

## Health Detection Logic

The health monitor uses a **sliding window of 20 outcomes** to track acquirer reliability.

### What Counts as Failure

- `error` and `timeout` outcomes are failures
- `declined` is treated as normal operation (business logic, not infrastructure)

### State Transitions

```
healthy --[failRate > 30%]--> degraded
healthy --[5 consecutive failures]--> down
degraded --[5 consecutive failures OR failRate > 50%]--> down
degraded --[successRate > 80% AND 0 consecutive failures]--> healthy
down --[3 consecutive successes]--> degraded
```

Down acquirers are **excluded from routing entirely**. Degraded acquirers receive a 0.3x health multiplier, reducing their selection probability without fully excluding them.

## Fallback Sequencing

When the primary acquirer is selected, the engine also produces an ordered fallback sequence:

1. Exclude the primary acquirer and any down acquirers
2. Score remaining acquirers by approval rate for the transaction segment
3. Filter out acquirers with <50% approval rate
4. Return top 2-3 fallbacks in descending approval rate order

## Example Routing Decisions

### 1. MXN Credit Card -- Balanced Mode

```json
{
  "amount": 200, "currency": "MXN", "cardType": "credit", "country": "MX"
}
```

**Result:** Route to Acquirer A (95% approval for MXN credit cards vs 89% for B and 65% for C). Fallback: B, then C.

### 2. Low-Value USD -- Cost Conscious Mode

```json
{
  "amount": 50, "currency": "USD", "cardType": "credit", "country": "US",
  "optimizationMode": "cost_conscious"
}
```

**Result:** Route to Acquirer C (84% approval, 2.1% take rate). The cost weight (0.40) favors C's lower fees, and its approval rate is within 5pp of the best, so the safety override does not trigger. Fallback: B, then A.

### 3. High-Value BRL Debit -- Maximize Approvals

```json
{
  "amount": 1500, "currency": "BRL", "cardType": "debit", "country": "BR",
  "optimizationMode": "maximize_approvals"
}
```

**Result:** Route to Acquirer B (91% approval for BRL debit). With 0.80 weight on approval rate, B's segment advantage wins despite higher cost. Fallback: A, then C.

## Comparison Results

| Metric | Smart Routing | Round-Robin |
|--------|:-:|:-:|
| Overall Approval Rate | 88.95% | 81.80% |
| Lift | +7.15 pp | -- |
| Est. Monthly Revenue Lift | $107,250 | -- |

**Per-segment improvements:**

| Segment | Smart | Round-Robin | Lift |
|---------|:-:|:-:|:-:|
| MXN transactions | 90.5% | 82.7% | +7.79 pp |
| Mid-value ($100-500) | 90.4% | 82.9% | +7.51 pp |
| Credit cards | 89.2% | 81.8% | +7.45 pp |
| BRL transactions | 89.6% | 82.3% | +7.35 pp |
| High-value ($500+) | 88.5% | 81.9% | +6.64 pp |
| Debit cards | 88.7% | 82.8% | +5.88 pp |

**Routing distribution:** Acquirer A handles 83.4% of traffic, Acquirer C handles 16.6%. Acquirer B is never the primary choice in balanced mode -- its higher take rate offsets its approval advantage in most segments.

## Trade-offs (2-Hour Constraint)

1. **In-memory only** -- No database; historical data loaded from JSON at startup. Fine for a prototype but would not survive restarts in production.
2. **Singleton health monitor** -- Initialized once from historical data. A production system would use persistent state and real-time event streams.
3. **Simplified comparison** -- When smart routing selects a different acquirer than the one in historical data, we estimate using the selected acquirer's approval rate rather than running a true counterfactual simulation.
4. **No authentication** -- API endpoints are unprotected. Production would need API key validation.
5. **Static acquirer config** -- Acquirer list and take rates are hardcoded. Production would pull from a database or configuration service.
6. **Single-node** -- No horizontal scaling, no distributed health state.

## Future Improvements

- **Machine learning model** for approval prediction using transaction features (BIN, time-of-day, merchant category)
- **A/B testing framework** to validate routing improvements against a control group
- **Real-time streaming** with Kafka/Redis for health events instead of synchronous recording
- **Multi-armed bandit** exploration to discover improving acquirers instead of pure exploitation
- **Persistent storage** (PostgreSQL) for health state, routing decisions, and audit trails
- **Dashboard UI** for real-time monitoring of routing distribution and approval rates
- **Circuit breaker patterns** with configurable thresholds per acquirer
- **Webhook notifications** when acquirer health transitions occur

## Project Structure

```
atlas-routing-engine/
  src/
    config/acquirers.ts        # Acquirer configurations (name, take rate)
    data/generator.ts          # Generates historical.json + sample-requests.json
    data/historical.json       # 1000 simulated transactions (7 days)
    data/sample-requests.json  # 30 diverse payment requests
    models/types.ts            # TypeScript interfaces
    routes/payments.ts         # POST /api/route
    routes/health.ts           # GET /api/health
    routes/demo.ts             # GET /api/demo
    services/
      performance-analyzer.ts  # Segmented approval rate computation
      health-monitor.ts        # Sliding window health tracking
      routing-engine.ts        # Core multi-factor scoring engine
      fallback-sequencer.ts    # Smart fallback ordering
    utils/comparison.ts        # Smart vs round-robin comparison analysis
    index.ts                   # Express server wiring
  tests/routing.test.ts        # Unit tests (16 tests, node assert)
  scripts/demo.sh              # End-to-end demo script
  package.json
  tsconfig.json
```
