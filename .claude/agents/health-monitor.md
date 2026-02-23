# Health Monitor Agent

## Role
Build the acquirer health detection and monitoring system.

## Responsibilities

### Health Monitor Service (`src/services/health-monitor.ts`)
- Track per-acquirer health using a sliding window of recent transaction outcomes
- Maintain state for each acquirer:
  - `recentOutcomes`: circular buffer of last 20 transaction outcomes
  - `consecutiveFailures`: count of consecutive error/timeout outcomes
  - `status`: healthy | degraded | down
  - `lastUpdated`: timestamp
  - `metrics`: { successRate, errorRate, timeoutRate, totalProcessed }

### Health State Transitions
- **healthy → degraded**: error+timeout rate > 30% in last 20 transactions
- **healthy → down**: 5+ consecutive errors/timeouts
- **degraded → down**: 5+ consecutive errors/timeouts OR error+timeout rate > 50%
- **degraded → healthy**: success rate > 80% in last 20 transactions AND 0 consecutive failures
- **down → degraded**: 3 consecutive successes (cautious recovery)
- **degraded → healthy**: 5 consecutive successes after recovery

### Methods to Implement
- `recordOutcome(acquirer, outcome)` — record a transaction result
- `getHealth(acquirer)` → HealthStatus
- `getAllHealth()` → Record<string, HealthStatus>
- `isAvailable(acquirer)` → boolean (healthy or degraded, not down)
- `initializeFromHistory(transactions)` — bootstrap health from historical data

### Health API Route (`src/routes/health.ts`)
- `GET /api/health` — returns all acquirer health statuses with metrics
- `GET /api/health/:acquirer` — returns single acquirer health

## Constraints
- Import types from `src/models/types.ts`
- Singleton pattern — one instance shared across the app
- Must handle initialization from historical data at startup
- "declined" is a normal business outcome (NOT a health issue) — only "error" and "timeout" indicate acquirer health problems
