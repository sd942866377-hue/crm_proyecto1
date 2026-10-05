#!/usr/bin/env bash
# Smoke test for crm_proyecto1 Flask server
# Usage: bash .claude/skills/run-crm-proyecto1/smoke.sh
set -e

PORT=5000
BASE="http://localhost:$PORT"

echo "=== CRM Seguridad smoke test ==="

# 1. Start server in background
python main.py &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Wait for server
for i in $(seq 1 10); do
  if curl -sf "$BASE/" > /dev/null 2>&1; then break; fi
  sleep 1
done

# 2. GET /  -> HTML
echo -n "GET /  ... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[ "$STATUS" = "200" ] && echo "OK ($STATUS)" || { echo "FAIL ($STATUS)"; exit 1; }

# 3. GET /api/clientes -> JSON
echo -n "GET /api/clientes  ... "
BODY=$(curl -sf "$BASE/api/clientes")
echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'clientes' in d" \
  && echo "OK" || { echo "FAIL"; exit 1; }

# 4. POST /api/clientes -> register
echo -n "POST /api/clientes ... "
RESP=$(curl -sf -X POST "$BASE/api/clientes" \
  -H "Content-Type: application/json" \
  -d '{"cliente":"Smoke Test","telefono":"900000000","estado":"Interesado",
       "procedencia":"smoke","fecha":"2026-10-05","hora":"00:00",
       "distrito":"Lima","direccion":"","archivo_origen":"smoke",
       "contacto_observacion":"","observacion":"smoke","estado_seguimiento":"",
       "historial_contactos":"","accion_contacto":""}')
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'" \
  && echo "OK" || { echo "FAIL"; exit 1; }

echo ""
echo "All checks passed."
