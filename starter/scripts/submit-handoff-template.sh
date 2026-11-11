#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Crea y somete a aprobación de WhatsApp la plantilla HSM del HANDOFF (el
# aviso al dueño cuando el bot escala una conversación a humano) vía la
# Content API de Twilio. Correr UNA vez.
#
# El contrato de variables es el de notifyOwner (src/tools/handoffHuman.ts):
#   {{1}} = motivo del handoff   {{2}} = resumen   {{3}} = link del ticket
#
# Credenciales: las lee de .dev.vars (raíz del repo, gitignored) o del entorno.
#   .dev.vars formato:
#     TWILIO_ACCOUNT_SID=ACxxxxxxxx
#     TWILIO_AUTH_TOKEN=xxxxxxxx
#
# USO:  ./scripts/submit-handoff-template.sh
# Al aprobar (Console → Content Template Builder), setear el secret:
#   npx wrangler secret put TWILIO_HANDOFF_CONTENT_SID   (pegar el HX… que imprime)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .dev.vars ]]; then
  set -a; source .dev.vars; set +a
fi
: "${TWILIO_ACCOUNT_SID:?Falta TWILIO_ACCOUNT_SID (ponlo en .dev.vars o exporta)}"
: "${TWILIO_AUTH_TOKEN:?Falta TWILIO_AUTH_TOKEN (ponlo en .dev.vars o exporta)}"

AUTH="$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"

NAME="handoff_aviso_dueno"
BODY="🔔 Tu bot te necesita con un cliente.

Motivo: {{1}}

Resumen: {{2}}

Atiende la conversación aquí: {{3}}"

echo "── $NAME"
SID=$(curl -s -X POST "https://content.twilio.com/v1/Content" \
  -u "$AUTH" -H "Content-Type: application/json" \
  -d "$(python3 - "$NAME" "$BODY" <<'PY'
import json, sys
print(json.dumps({
  "friendly_name": sys.argv[1],
  "language": "es_MX",
  "variables": {"1": "el cliente pidió hablar con una persona", "2": "María pagó y no recibió su acceso", "3": "https://example.com/admin/conversations?c=abc"},
  "types": {"twilio/text": {"body": sys.argv[2]}},
}))
PY
)" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sid') or f\"ERROR: {d}\")")

if [[ "$SID" != HX* ]]; then
  echo "   ✗ no se pudo crear: $SID"
  exit 1
fi
echo "   creada: $SID"

# UTILITY (no marketing): es una notificación operativa al dueño — se aprueba
# más fácil y no le aplican las reglas de marketing de Meta.
STATUS=$(curl -s -X POST "https://content.twilio.com/v1/Content/$SID/ApprovalRequests/whatsapp" \
  -u "$AUTH" -H "Content-Type: application/json" \
  -d "{\"name\": \"$NAME\", \"category\": \"UTILITY\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status') or f\"ERROR: {d}\")")
echo "   aprobación: $STATUS"

echo ""
echo "ContentSid: $SID"
echo "Cuando aparezca APPROVED en Console → Messaging → Content Template Builder:"
echo "  npx wrangler secret put TWILIO_HANDOFF_CONTENT_SID   ← pegar: $SID"
