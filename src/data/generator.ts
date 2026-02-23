import * as fs from 'fs';
import * as path from 'path';
import { Transaction, PaymentRequest, Currency, Country, CardType, Outcome } from '../models/types';

// Seeded PRNG (Linear Congruential Generator)
class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  next(): number {
    // LCG parameters from Numerical Recipes
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0xffffffff;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

const ACQUIRER_TAKE_RATES: Record<string, number> = {
  A: 2.8,
  B: 3.1,
  C: 2.1,
};

const CURRENCIES: Currency[] = ['MXN', 'BRL', 'USD'];
const COUNTRIES: Country[] = ['MX', 'BR', 'US'];
const CARD_TYPES: CardType[] = ['credit', 'debit'];
const ACQUIRERS = ['A', 'B', 'C'];

const CURRENCY_COUNTRY_MAP: Record<Currency, Country> = {
  MXN: 'MX',
  BRL: 'BR',
  USD: 'US',
};

function generateUUID(rng: SeededRandom): string {
  const hex = '0123456789abcdef';
  const parts = [8, 4, 4, 4, 12];
  return parts
    .map((len) => {
      let s = '';
      for (let i = 0; i < len; i++) {
        s += hex[Math.floor(rng.next() * 16)];
      }
      return s;
    })
    .join('-');
}

function generateAmount(rng: SeededRandom): number {
  // Range: $10 - $2000
  const raw = 10 + rng.next() * 1990;
  return Math.round(raw * 100) / 100;
}

function determineOutcome(
  rng: SeededRandom,
  acquirer: string,
  amount: number,
  currency: Currency,
  cardType: CardType,
  hoursSinceStart: number
): Outcome {
  const roll = rng.next();

  if (acquirer === 'A') {
    // During hours 48-52 (4-hour outage window): 90% error/timeout
    if (hoursSinceStart >= 48 && hoursSinceStart < 52) {
      if (roll < 0.10) return 'approved';
      if (roll < 0.55) return 'error';
      return 'timeout';
    }
    // Normal: ~85% approval
    if (roll < 0.85) return 'approved';
    if (roll < 0.92) return 'declined';
    if (roll < 0.97) return 'error';
    return 'timeout';
  }

  if (acquirer === 'B') {
    if (currency === 'MXN' && cardType === 'credit') {
      // 92% approval for credit cards with MXN
      if (roll < 0.92) return 'approved';
      if (roll < 0.97) return 'declined';
      return 'error';
    }
    if (currency === 'MXN' && cardType === 'debit') {
      // 71% approval for debit cards with MXN
      if (roll < 0.71) return 'approved';
      if (roll < 0.88) return 'declined';
      if (roll < 0.95) return 'error';
      return 'timeout';
    }
    // ~83% for other combos
    if (roll < 0.83) return 'approved';
    if (roll < 0.93) return 'declined';
    if (roll < 0.97) return 'error';
    return 'timeout';
  }

  if (acquirer === 'C') {
    if (amount > 500) {
      // 68% approval for amounts > $500
      if (roll < 0.68) return 'approved';
      if (roll < 0.85) return 'declined';
      if (roll < 0.94) return 'error';
      return 'timeout';
    }
    // 89% for amounts <= $500
    if (roll < 0.89) return 'approved';
    if (roll < 0.95) return 'declined';
    if (roll < 0.98) return 'error';
    return 'timeout';
  }

  return 'declined';
}

function generateProcessingTime(rng: SeededRandom, acquirer: string, outcome: Outcome): number {
  // Base processing times by acquirer
  const bases: Record<string, number> = { A: 180, B: 220, C: 150 };
  const base = bases[acquirer] || 200;
  let ms = base + rng.next() * 300;

  // Timeouts take longer
  if (outcome === 'timeout') ms += 2000 + rng.next() * 3000;
  // Errors slightly longer
  if (outcome === 'error') ms += 200 + rng.next() * 500;

  return Math.round(ms);
}

function generateTransactions(): Transaction[] {
  const rng = new SeededRandom(42);
  const transactions: Transaction[] = [];

  // 7-day period starting from a fixed date
  const startDate = new Date('2026-02-17T00:00:00.000Z');
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < 1000; i++) {
    // Spread transactions across the 7-day window
    const offsetMs = rng.next() * sevenDaysMs;
    const timestamp = new Date(startDate.getTime() + offsetMs);
    const hoursSinceStart = offsetMs / (1000 * 60 * 60);

    const acquirer = rng.pick(ACQUIRERS);
    const currency = rng.pick(CURRENCIES);
    const country = CURRENCY_COUNTRY_MAP[currency];
    const cardType = rng.pick(CARD_TYPES);
    const amount = generateAmount(rng);

    const outcome = determineOutcome(rng, acquirer, amount, currency, cardType, hoursSinceStart);
    const processingTimeMs = generateProcessingTime(rng, acquirer, outcome);

    transactions.push({
      id: generateUUID(rng),
      timestamp: timestamp.toISOString(),
      acquirer,
      amount,
      currency,
      cardType,
      country,
      outcome,
      takeRate: ACQUIRER_TAKE_RATES[acquirer],
      processingTimeMs,
    });
  }

  // Sort by timestamp
  transactions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return transactions;
}

function generateSampleRequests(): PaymentRequest[] {
  const requests: PaymentRequest[] = [
    // Edge cases: tiny amount
    { amount: 10, currency: 'MXN', cardType: 'credit', country: 'MX' },
    { amount: 10, currency: 'BRL', cardType: 'debit', country: 'BR' },
    { amount: 10, currency: 'USD', cardType: 'credit', country: 'US' },

    // Edge cases: just under $500 threshold
    { amount: 499, currency: 'MXN', cardType: 'credit', country: 'MX' },
    { amount: 499, currency: 'BRL', cardType: 'debit', country: 'BR' },
    { amount: 499, currency: 'USD', cardType: 'credit', country: 'US' },

    // Edge cases: just over $500 threshold
    { amount: 501, currency: 'MXN', cardType: 'debit', country: 'MX' },
    { amount: 501, currency: 'BRL', cardType: 'credit', country: 'BR' },
    { amount: 501, currency: 'USD', cardType: 'debit', country: 'US' },

    // Edge cases: high value
    { amount: 1500, currency: 'MXN', cardType: 'credit', country: 'MX' },
    { amount: 1500, currency: 'BRL', cardType: 'debit', country: 'BR' },
    { amount: 1500, currency: 'USD', cardType: 'credit', country: 'US' },

    // Max amount
    { amount: 2000, currency: 'MXN', cardType: 'debit', country: 'MX' },
    { amount: 2000, currency: 'BRL', cardType: 'credit', country: 'BR' },
    { amount: 2000, currency: 'USD', cardType: 'debit', country: 'US' },

    // Mid-range amounts — diverse combos
    { amount: 150, currency: 'MXN', cardType: 'credit', country: 'MX' },
    { amount: 250, currency: 'BRL', cardType: 'debit', country: 'BR' },
    { amount: 350, currency: 'USD', cardType: 'credit', country: 'US' },
    { amount: 75.50, currency: 'MXN', cardType: 'debit', country: 'MX' },
    { amount: 420, currency: 'BRL', cardType: 'credit', country: 'BR' },
    { amount: 600, currency: 'USD', cardType: 'debit', country: 'US' },

    // More mid-range with varied card types
    { amount: 880, currency: 'MXN', cardType: 'credit', country: 'MX' },
    { amount: 199.99, currency: 'BRL', cardType: 'debit', country: 'BR' },
    { amount: 1200, currency: 'USD', cardType: 'credit', country: 'US' },
    { amount: 55, currency: 'MXN', cardType: 'debit', country: 'MX' },
    { amount: 750, currency: 'BRL', cardType: 'credit', country: 'BR' },
    { amount: 333.33, currency: 'USD', cardType: 'debit', country: 'US' },

    // Additional edge combos
    { amount: 500, currency: 'MXN', cardType: 'credit', country: 'MX' },
    { amount: 500, currency: 'BRL', cardType: 'debit', country: 'BR' },
    { amount: 1000, currency: 'USD', cardType: 'credit', country: 'US' },
  ];

  return requests;
}

// Main execution
const transactions = generateTransactions();
const sampleRequests = generateSampleRequests();

const dataDir = path.join(__dirname);

fs.writeFileSync(
  path.join(dataDir, 'historical.json'),
  JSON.stringify(transactions, null, 2)
);

fs.writeFileSync(
  path.join(dataDir, 'sample-requests.json'),
  JSON.stringify(sampleRequests, null, 2)
);

console.log(`Generated ${transactions.length} historical transactions`);
console.log(`Generated ${sampleRequests.length} sample payment requests`);

// Quick stats
const stats: Record<string, { total: number; approved: number }> = {};
for (const t of transactions) {
  if (!stats[t.acquirer]) stats[t.acquirer] = { total: 0, approved: 0 };
  stats[t.acquirer].total++;
  if (t.outcome === 'approved') stats[t.acquirer].approved++;
}
console.log('\nApproval rates by acquirer:');
for (const [acq, s] of Object.entries(stats)) {
  console.log(`  ${acq}: ${((s.approved / s.total) * 100).toFixed(1)}% (${s.approved}/${s.total})`);
}

// Acquirer A outage window stats
const outageTransactions = transactions.filter((t) => {
  const startDate = new Date('2026-02-17T00:00:00.000Z');
  const hours = (new Date(t.timestamp).getTime() - startDate.getTime()) / (1000 * 60 * 60);
  return t.acquirer === 'A' && hours >= 48 && hours < 52;
});
if (outageTransactions.length > 0) {
  const outageApproved = outageTransactions.filter((t) => t.outcome === 'approved').length;
  console.log(`\nAcquirer A outage window (hours 48-52): ${((outageApproved / outageTransactions.length) * 100).toFixed(1)}% approval (${outageApproved}/${outageTransactions.length})`);
}

// Acquirer B MXN breakdown
const bMxnCredit = transactions.filter((t) => t.acquirer === 'B' && t.currency === 'MXN' && t.cardType === 'credit');
const bMxnDebit = transactions.filter((t) => t.acquirer === 'B' && t.currency === 'MXN' && t.cardType === 'debit');
console.log(`\nAcquirer B MXN credit: ${((bMxnCredit.filter((t) => t.outcome === 'approved').length / (bMxnCredit.length || 1)) * 100).toFixed(1)}% (${bMxnCredit.length} txns)`);
console.log(`Acquirer B MXN debit: ${((bMxnDebit.filter((t) => t.outcome === 'approved').length / (bMxnDebit.length || 1)) * 100).toFixed(1)}% (${bMxnDebit.length} txns)`);

// Acquirer C amount breakdown
const cHigh = transactions.filter((t) => t.acquirer === 'C' && t.amount > 500);
const cLow = transactions.filter((t) => t.acquirer === 'C' && t.amount <= 500);
console.log(`\nAcquirer C >$500: ${((cHigh.filter((t) => t.outcome === 'approved').length / (cHigh.length || 1)) * 100).toFixed(1)}% (${cHigh.length} txns)`);
console.log(`Acquirer C <=$500: ${((cLow.filter((t) => t.outcome === 'approved').length / (cLow.length || 1)) * 100).toFixed(1)}% (${cLow.length} txns)`);
