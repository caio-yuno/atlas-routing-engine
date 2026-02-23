# API Builder Agent

## Role
Implement REST API endpoints and the smart fallback sequencing service.

## Responsibilities

### Payment Routing Endpoint (`src/routes/payments.ts`)
- `POST /api/route` — accepts a payment request, returns routing decision
  - Request body: `{ amount, currency, cardType, country, optimizationMode? }`
  - Response: `{ selectedAcquirer, score, justification, scores: {...}, fallbackSequence: [...], optimizationMode }`
  - Validate input fields
  - Call RoutingEngine.route() and FallbackSequencer.getSequence()

### Demo Endpoint (`src/routes/demo.ts`)
- `GET /api/demo` — runs all 30 sample requests through the routing engine
  - Returns array of routing decisions
  - Includes summary statistics (how many routed to each acquirer, average scores)
  - Includes comparison vs round-robin (approval rate lift)

### Fallback Sequencer (`src/services/fallback-sequencer.ts`) — Stretch Goal B
- Given a primary routing decision, return ordered fallback sequence of 2-3 acquirers
- Ordering logic:
  1. Primary: highest scored acquirer (from routing engine)
  2. Secondary: next highest scored acquirer that is NOT down
  3. Tertiary: remaining acquirer if available and not down
- Exclude acquirers that are `down`
- Exclude acquirers known to have poor rates for this transaction type (approval rate < 50%)
- Each fallback entry includes: acquirer name, expected approval rate, reason

### Wire Everything Together
- Import and initialize PerformanceAnalyzer, HealthMonitor, RoutingEngine, FallbackSequencer in `src/index.ts`
- Load historical data at startup
- Initialize health monitor from historical data

## Constraints
- Import types from `src/models/types.ts`
- Use services from other agents (routing-engine, health-monitor, performance-analyzer)
- Input validation with clear error messages
- JSON responses with consistent structure
