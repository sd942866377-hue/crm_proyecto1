#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Crea y somete a aprobación de Meta las 3 plantillas HSM de la masterclass
# (Twilio Content API). Idempotente-ish: si ya existe una con el mismo nombre,
# Twilio crea otra — correr UNA vez.
#
# Credenciales: las lee de .dev.vars (raíz del repo, gitignored) o del entorno.
#   .dev.vars formato:
#     TWILIO_ACCOUNT_SID=ACxxxxxxxx
#     TWILIO_AUTH_TOKEN=xxxxxxxx
#
# USO:  ./scripts/submit-wa-templates.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .dev.vars ]]; then
  set -a; source .dev.vars; set +a
fi
: "${TWILIO_ACCOUNT_SID:?Falta TWILIO_ACCOUNT_SID (ponlo en .dev.vars o exporta)}"
: "${TWILIO_AUTH_TOKEN:?Falta TWILIO_AUTH_TOKEN (ponlo en .dev.vars o exporta)}"

AUTH="$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"

create_and_submit() {
  local name="$1" body="$2"
  echo "── $name"
  local sid
  sid=$(curl -s -X POST "https://content.twilio.com/v1/Content" \
    -u "$AUTH" -H "Content-Type: application/json" \
    -d "$(python3 - "$name" "$body" <<'PY'
import json, sys
print(json.dumps({
  "friendly_name": sys.argv[1],
  "language": "es_MX",
  "variables": {"1": "Ana"},
  "types": {"twilio/text": {"body": sys.argv[2]}},
}))
PY
)" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sid') or f\"ERROR: {d}\")")

  if [[ "$sid" != HX* ]]; then
    echo "   ✗ no se pudo crear: $sid"
    return 1
  fi
  echo "   creada: $sid"

  local status
  status=$(curl -s -X POST "https://content.twilio.com/v1/Content/$sid/ApprovalRequests/whatsapp" \
    -u "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\": \"$name\", \"category\": \"MARKETING\"}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status') or f\"ERROR: {d}\")")
  echo "   aprobación: $status"
}

create_and_submit "recordatorio_evento" \
  "¡Hola {{1}}! 👋 Hoy es la masterclass gratuita de Agentes IA con Claude Code — 1:00 PM (CDMX), 90 min, 100% en vivo y sin repetición completa. ¿Te esperamos? Responde SÍ y te mando tu acceso."

create_and_submit "replay_48h" \
  "{{1}}, el replay de la masterclass de Agentes IA está disponible solo 48 horas. ¿Quieres que te pase el link con los bonos incluidos? Responde REPLAY y te lo mando."

create_and_submit "ultimo_dia" \
  "{{1}}, hoy a las 11:59 PM (CDMX) cierra el precio founder de la comunidad Horizontes IA. Si te quedó alguna duda, respóndeme por aquí y te ayudo antes de que cierre."

echo ""
echo "Listo. Revisa el estado en: Twilio Console → Messaging → Content Template Builder"
echo "(y en unos minutos/horas en el dropdown de plantillas de /admin/campanas)"
