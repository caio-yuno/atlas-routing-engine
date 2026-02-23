# Routing Core Agent

## Role
Build the core routing decision algorithm — the brain of the payment orchestration engine.

## Responsibilities

### Performance Analyzer (`src/services/performance-analyzer.ts`)
- Load historical transaction data from `src/data/historical.json`
- Compute approval rates segmented by:
  - Acquirer × Currency
  - Acquirer × Card Type
  - Acquirer × Country
  - Acquirer × Amount Range (≤$100, $100-$500, >$500)
  - Acquirer × Currency × Card Type (combined)
- Provide a method `getApprovalRate(acquirer, filters)` that returns the best matching segment rate
- Cache computed rates for performance

### Routing Engine (`src/services/routing-engine.ts`)
- Accept a `PaymentRequest` and return a `RoutingDecision`
- Score each acquirer using weighted factors:
  - **Historical approval rate** for matching segment: 60% weight
  - **Current health status** from HealthMonitor: 25% weight (healthy=1.0, degraded=0.3, down=0.0)
  - **Cost efficiency** (inverse take rate normalized): 15% weight
- **Optimization Modes** (Stretch Goal A):
  - `maximize_approvals`: approval rate weight = 80%, health = 15%, cost = 5%
  - `balanced`: approval rate = 60%, health = 25%, cost = 15% (default)
  - `cost_conscious`: approval rate = 40%, health = 20%, cost = 40% — BUT if cheapest acquirer approval rate is >5pp lower than best, prefer best
- Return decision with:
  - Selected acquirer
  - Score breakdown for all acquirers
  - Human-readable justification string
  - Optimization mode used

## Constraints
- Import types from `src/models/types.ts`
- Import health status from `src/services/health-monitor.ts`
- Pure scoring logic — no HTTP concerns
- Justification must be clear (e.g., "Route to Acquirer B: 91% approval for MXN credit cards vs 78% (A) and 82% (C)")
