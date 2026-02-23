#!/usr/bin/env bash
set -e

PORT=3000
BASE="http://localhost:$PORT"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "============================================"
echo "  Atlas Commerce Smart Routing Engine Demo"
echo "============================================"
echo ""

# Start server in background
echo "[1/5] Starting server..."
npx ts-node src/index.ts &
SERVER_PID=$!

# Wait for server to be ready
echo "       Waiting for server to be ready..."
for i in $(seq 1 30); do
  if curl -s "$BASE/" > /dev/null 2>&1; then
    echo "       Server ready on port $PORT"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "       ERROR: Server did not start in time"
    exit 1
  fi
  sleep 0.5
done
echo ""

# Send diverse routing requests
echo "[2/5] Sending routing requests..."
echo ""

echo "--- Request 1: MXN credit, balanced mode ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":200,"currency":"MXN","cardType":"credit","country":"MX"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 2: BRL debit, maximize approvals ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":500,"currency":"BRL","cardType":"debit","country":"BR","optimizationMode":"maximize_approvals"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 3: USD credit, cost conscious ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":50,"currency":"USD","cardType":"credit","country":"US","optimizationMode":"cost_conscious"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 4: High-value MXN debit ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":1500,"currency":"MXN","cardType":"debit","country":"MX"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 5: Low-value BRL credit ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":25,"currency":"BRL","cardType":"credit","country":"BR"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 6: Mid-value USD debit, balanced ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":350,"currency":"USD","cardType":"debit","country":"US"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 7: High-value BRL credit, cost conscious ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":1800,"currency":"BRL","cardType":"credit","country":"BR","optimizationMode":"cost_conscious"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 8: MXN credit, maximize approvals ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":499,"currency":"MXN","cardType":"credit","country":"MX","optimizationMode":"maximize_approvals"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 9: Low-value USD credit ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":10,"currency":"USD","cardType":"credit","country":"US"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 10: Max-value MXN debit, cost conscious ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":2000,"currency":"MXN","cardType":"debit","country":"MX","optimizationMode":"cost_conscious"}' | jq '{selectedAcquirer, justification, optimizationMode}'
echo ""

echo "--- Request 11: BRL debit, balanced (with full scores) ---"
curl -s -X POST "$BASE/api/route" \
  -H "Content-Type: application/json" \
  -d '{"amount":250,"currency":"BRL","cardType":"debit","country":"BR"}' | jq '{selectedAcquirer, justification, scores: [.scores[] | {acquirer, totalScore: (.totalScore * 100 | round / 100), approvalRate: (.approvalRate * 100 | round / 100 | tostring + "%"), healthStatus}], fallbackSequence: [.fallbackSequence[] | {acquirer, reason}]}'
echo ""

# Health status
echo "[3/5] Fetching acquirer health..."
echo ""
curl -s "$BASE/api/health" | jq 'to_entries[] | {acquirer: .key, status: .value.status, consecutiveFailures: .value.consecutiveFailures, metrics: .value.metrics}'
echo ""

# Demo endpoint with comparison
echo "[4/5] Fetching comparison analysis..."
echo ""
curl -s "$BASE/api/demo" | jq '{
  comparison: .comparison,
  summary: .summary,
  sampleDecisions: [.decisions[:3][] | {request: .request, selectedAcquirer: .selectedAcquirer, justification: .justification}]
}'
echo ""

echo "[5/5] Done!"
echo ""
echo "============================================"
echo "  Demo complete. Server shutting down."
echo "============================================"
