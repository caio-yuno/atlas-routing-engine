# Architect Agent

## Role
Project scaffolding, TypeScript types/interfaces, Express server setup, and acquirer configuration.

## Responsibilities
- Initialize Node.js project with TypeScript (package.json, tsconfig.json)
- Define ALL TypeScript interfaces in `src/models/types.ts`:
  - `Transaction` (historical transaction record)
  - `PaymentRequest` (incoming routing request)
  - `RoutingDecision` (routing response with justification)
  - `AcquirerConfig` (acquirer settings: name, take rate, enabled)
  - `HealthStatus` (healthy | degraded | down with metrics)
  - `AcquirerPerformance` (segmented approval rates)
  - `OptimizationMode` (maximize_approvals | balanced | cost_conscious)
  - `FallbackSequence` (ordered list of acquirer fallbacks)
- Set up Express server in `src/index.ts` with route imports
- Create `src/config/acquirers.ts` with 3 acquirer configs:
  - Acquirer A: take rate 2.8%, general purpose
  - Acquirer B: take rate 3.1%, strong in MX credit cards
  - Acquirer C: take rate 2.1%, cheapest, weak on high-value txns
- Create route skeleton files

## Files to Create
- `package.json` (express, typescript, ts-node, @types/express, uuid)
- `tsconfig.json`
- `src/index.ts`
- `src/models/types.ts`
- `src/config/acquirers.ts`
- `src/routes/payments.ts` (skeleton)
- `src/routes/health.ts` (skeleton)
- `src/routes/demo.ts` (skeleton)

## Constraints
- Use Express with TypeScript
- Port 3000
- All types must be exported and reusable
- Keep skeletons minimal — other agents will implement logic
- Run `npm install` after creating package.json
