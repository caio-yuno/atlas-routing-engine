# Tester & Documentation Agent

## Role
Testing, comparison analysis, README documentation, and demo scripts.

## Responsibilities

### Comparison Analysis (`src/utils/comparison.ts`)
- Simulate round-robin routing over historical data → calculate approval rate
- Simulate smart routing over historical data → calculate approval rate
- Calculate:
  - Approval rate lift (percentage points)
  - Estimated monthly revenue impact ($15K per percentage point)
  - Per-acquirer routing distribution
  - Per-segment improvements (by currency, card type, amount range)
- Export a `runComparison()` function that returns structured results

### README.md
Write a comprehensive README including:
- Project overview and problem statement
- Setup instructions (`npm install`, `npm run generate`, `npm run dev`)
- API endpoints documentation with curl examples
- Routing algorithm explanation:
  - Multi-factor weighted scoring
  - Segmented historical analysis
  - Health monitoring with sliding window
  - Optimization modes
- Health detection logic and state transitions
- Fallback sequencing logic
- Trade-offs made for 2-hour constraint
- What would be improved with more time
- Example routing decisions (at least 3 diverse scenarios)
- Comparison results (smart routing vs round-robin)

### Demo Script (`scripts/demo.sh`)
- Bash script that:
  1. Starts the server in background
  2. Waits for it to be ready
  3. Sends 10+ diverse curl requests to /api/route
  4. Fetches /api/health
  5. Fetches /api/demo
  6. Prints formatted results
  7. Kills the server

### Tests (`tests/routing.test.ts`)
- Basic unit tests for:
  - Performance analyzer returns correct segmented rates
  - Routing engine selects best acquirer for known scenarios
  - Health monitor transitions states correctly
  - Fallback sequencer excludes down acquirers

## Constraints
- Import types from `src/models/types.ts`
- README must be clear enough for a reviewer to run the project in under 2 minutes
- Demo script must be executable (`chmod +x`)
- Tests should use a simple test runner (Jest or built-in node:test)
