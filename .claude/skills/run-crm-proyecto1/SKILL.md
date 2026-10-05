---
name: run-crm-proyecto1
description: Run, start, build, test, screenshot, or smoke-test the CRM Seguridad Flask server (crm_proyecto1). Drives the app with curl via smoke.sh.
---

# run-crm-proyecto1

Flask + SQLite CRM web app with a Telegram bot integration.
Driven programmatically by `smoke.sh` (curl-based smoke script).
No GUI — all interaction is HTTP.

## Prerequisites

```bash
pip install flask telebot --break-system-packages --ignore-installed blinker
```

Note: `blinker` system package conflicts; `--ignore-installed` resolves it.

## Run (agent path)

```bash
cd /home/user/crm_proyecto1
bash .claude/skills/run-crm-proyecto1/smoke.sh
```

The script:
1. Starts `python main.py` on port 5000
2. `GET /` — verifies HTML response 200
3. `GET /api/clientes` — verifies JSON shape
4. `POST /api/clientes` — registers a record, verifies `status: ok`
5. Kills the server on exit

All output goes to stdout. Exit 0 = pass.

## Run (human path)

```bash
cd /home/user/crm_proyecto1
python main.py
```

Server starts at `http://localhost:5000`. Open in browser. Ctrl-C to stop.

Telegram bot will print a warning and skip if `TELEGRAM_BOT_TOKEN` env var is not set — that's normal.

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serves `index.html` frontend |
| GET | `/api/clientes?estado=&page=1` | List clients (paginated, 10/page) |
| POST | `/api/clientes` | Register/update a client |

POST body fields: `cliente`, `telefono`, `estado` (required); `procedencia`, `fecha`, `hora`, `distrito`, `direccion`, `archivo_origen`, `contacto_observacion`, `observacion`, `estado_seguimiento`, `historial_contactos`, `accion_contacto` (optional).

## Test manually

```bash
# List clients
curl http://localhost:5000/api/clientes

# Register client
curl -X POST http://localhost:5000/api/clientes \
  -H "Content-Type: application/json" \
  -d '{"cliente":"Test","telefono":"999000000","estado":"Interesado"}'
```

## Gotchas

- **blinker conflict** — system blinker 1.7.0 blocks pip install. Fix: `--ignore-installed blinker`.
- **Telegram token warning** — printed on every start when `TELEGRAM_BOT_TOKEN` is unset. Bot thread simply exits. Server still works.
- **Port 5000 already in use** — run `kill $(lsof -ti:5000)` before starting.
- **DB file** — `crm_seguridad.db` is created in the project root on first run. Do not delete mid-test.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `ERROR: Cannot uninstall blinker` | Add `--ignore-installed blinker` to pip command |
| `Address already in use` on port 5000 | `kill $(lsof -ti:5000)` |
| `ModuleNotFoundError: telebot` | Re-run prerequisites install |
| Bot prints error on start | Set `TELEGRAM_BOT_TOKEN` env var or ignore — server unaffected |
