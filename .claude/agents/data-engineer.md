# Data Engineer Agent

## Role
Generate realistic test data for the routing engine — historical transactions and sample payment requests.

## Responsibilities
- Build `src/data/generator.ts` that creates test data
- Generate 1000 historical transactions with these REQUIRED patterns:
  - **Acquirer A**: Generally reliable (85% approval), BUT has a cluster of error/timeout outcomes during a 4-hour window (hours 10-14 in the dataset) simulating an outage
  - **Acquirer B**: 92% approval rate for credit cards in Mexico (MXN), only 71% for debit cards in Mexico
  - **Acquirer C**: 68% approval rate for transactions > $500, 89% for transactions ≤ $500. Lowest take rate (2.1%)
- Mix of currencies: MXN, BRL, USD
- Mix of countries: MX, BR, US
- Mix of card types: credit, debit
- Amount range: $10 - $2000
- Outcomes: approved, declined, error, timeout
- Each transaction has: id, timestamp, acquirer, amount, currency, cardType, country, outcome, takeRate, processingTimeMs
- Generate 30 sample incoming payment requests with diverse scenarios covering:
  - Different currencies, card types, countries
  - Low and high value amounts
  - Edge cases (very high amount, uncommon combinations)

## Output Files
- `src/data/historical.json` — array of 1000 Transaction objects
- `src/data/sample-requests.json` — array of 30 PaymentRequest objects

## Constraints
- Data must be deterministic (use seeded random or hardcoded patterns)
- Timestamps should span a 7-day period
- Take rates: Acquirer A = 2.8%, Acquirer B = 3.1%, Acquirer C = 2.1%
- Import types from `src/models/types.ts`
- Include a script command to run the generator
