-- Conversations: one row per (channel, channel_user_id) customer
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  display_name TEXT,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  paused_until INTEGER,
  open_ticket_id TEXT,
  metadata TEXT,
  -- Quién de la app la está atendiendo (JSON {id,name,at}). Los bots ya
  -- desplegados la agregan lazy en runtime (db/conversations.ts ensureTakenBy)
  -- porque update no re-ejecuta este archivo.
  taken_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_unique ON conversations(channel, channel_user_id);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  model_used TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  audio_seconds REAL,
  image_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at);

-- Libreta de gastos de IA: un renglón por cada llamada al LLM (conversación,
-- follow-ups, insights, copilot, reportes, flywheel, blindaje), etiquetado por
-- función y con su costo fino (caché-creation a 1.25×). La app la muestra
-- desglosada. También se auto-crea en runtime (src/db/ia-usage.ts) para los bots
-- que actualizaron sin re-correr este schema.
CREATE TABLE IF NOT EXISTS ia_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  fn TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  conversation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ia_usage_created ON ia_usage(created_at);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  name TEXT,
  contact TEXT,
  channel_user_id TEXT,
  intent TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'new',
  exported_to TEXT,
  external_id TEXT,
  -- JSON con campos propios del nicho (reservacion con fecha/hora/personas, o
  -- comprador con presupuesto/zona/operacion). El dashboard del nicho lee de aqui.
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  category TEXT,
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  resolved_at INTEGER,
  resolved_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS admin_emails (
  email TEXT PRIMARY KEY,
  role TEXT DEFAULT 'owner',
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_expires ON magic_links(expires_at);

-- Marca de "leído" por conversación (inbox móvil Forja Inbox): unread =
-- mensajes del cliente posteriores a last_read_at. Los bots ya desplegados la
-- crean lazy en runtime (db/conversationReads.ts) porque update no re-ejecuta
-- este archivo.
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id TEXT PRIMARY KEY,
  last_read_at INTEGER NOT NULL
);

-- Settings: key/value overlay edited from the dashboard. Empty/absent => default.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- AI-generated quality analysis: one row per conversation, written by the
-- insights analyzer (Haiku) once the conversation goes idle. Re-analyzed if
-- the customer comes back (analyzed_at < last_message_at).
-- sentiment: positive | neutral | frustrated | angry
-- resolution: resolved | unresolved | escalated | abandoned
-- bot_score: 1-5 quality of the bot's replies · topics: JSON array (es)
-- summary: 1-2 sentences (es) · missed_kb: question the KB couldn't answer
-- sale_opportunity: 1 = open sale left on the table
CREATE TABLE IF NOT EXISTS conversation_insights (
  conversation_id TEXT PRIMARY KEY,
  analyzed_at INTEGER NOT NULL,
  sentiment TEXT,
  resolution TEXT,
  bot_score INTEGER,
  topics TEXT,
  summary TEXT,
  missed_kb TEXT,
  sale_opportunity INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_insights_analyzed ON conversation_insights(analyzed_at);

-- Knowledge-base documents editable from the dashboard. Indexed into Vectorize
-- on save (chunked). The repo kb-fixtures.json remains a separate source.
-- NOTE: never put semicolons inside schema comments (the test helper splits on them).
CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Flywheel (F5) - every proposed self-improvement is a reviewable row.
-- kind: kb_entry | leccion. fingerprint dedupes across any status so a
-- dismissed suggestion is never re-proposed.
CREATE TABLE IF NOT EXISTS improvement_suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  evidence TEXT,
  status TEXT DEFAULT 'proposed',
  created_at INTEGER NOT NULL,
  applied_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sugg_status ON improvement_suggestions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sugg_fp ON improvement_suggestions(kind, fingerprint);

-- Follow-up bot - one row per conversation that ever received a follow-up.
-- The PRIMARY KEY doubles as the send claim (INSERT OR IGNORE) so a
-- conversation can never get more than one follow-up, ever.
CREATE TABLE IF NOT EXISTS followup_sends (
  conversation_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

-- Alertas de riesgo (Vigilante con IA, Pro) - one row per conversation that
-- ever triggered an owner alert. The PRIMARY KEY doubles as the send claim
-- (INSERT OR IGNORE) so a conversation can never alert the owner twice, ever.
-- sent_at feeds the global hourly throttle. reason: cliente molesto | venta en riesgo
CREATE TABLE IF NOT EXISTS risk_alerts (
  conversation_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_time ON risk_alerts(sent_at);

-- Per-customer memory extracted by the insights analyzer. Injected into the
-- system context when the same customer writes again.
CREATE TABLE IF NOT EXISTS customer_facts (
  conversation_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  learned_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, fact)
);

-- Links de trackeo del modo evento/masterclass (tool trackedLink).
-- Un código por (conversación, destino) — GET /l/:code loguea el click y redirige.
CREATE TABLE IF NOT EXISTS tracked_links (
  code TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  target TEXT NOT NULL,
  target_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_click_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tracked_links_conv ON tracked_links(conversation_id);

-- Hits de keywords del modo evento (QUIERO / RECURSOS) — alimenta el embudo
CREATE TABLE IF NOT EXISTS keyword_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keyword_hits_kw ON keyword_hits(keyword);

-- Etiquetas por conversación del modo evento (minería de objeciones + interés)
-- Las escribe el job labelConversations (cron cada 10 min) con el tier fast
CREATE TABLE IF NOT EXISTS conv_labels (
  conversation_id TEXT PRIMARY KEY,
  variant TEXT,
  interest TEXT,
  objection TEXT,
  summary TEXT,
  labeled_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_labels_interest ON conv_labels(interest);

-- Encuestas de satisfacción (superpoder Pro) - una fila por conversación que
-- ever recibió la encuesta. PRIMARY KEY = claim de envío (INSERT OR IGNORE).
-- score 1-5 se llena cuando el cliente responde (responded_at). Sin respuesta
-- queda NULL. El envío de la pregunta usa el cron frecuente.
CREATE TABLE IF NOT EXISTS survey_sends (
  conversation_id TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL,
  score INTEGER,
  responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_survey_sends_time ON survey_sends(sent_at);

-- Recupera no-shows / leads fríos (superpoder Pro) - una fila por conversación
-- que ever recibió el re-enganche de segundo toque. PRIMARY KEY = claim.
CREATE TABLE IF NOT EXISTS reengage_sends (
  conversation_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reengage_sends_time ON reengage_sends(sent_at);

-- Pide reseñas (superpoder Pro) - una fila por conversación que ever recibió la
-- invitación a dejar reseña. PRIMARY KEY = claim de envío único.
CREATE TABLE IF NOT EXISTS review_requests (
  conversation_id TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_requests_time ON review_requests(sent_at);

-- Opiniones abiertas de la encuesta (modo "abierto"/"ambos"): el texto libre que
-- el cliente escribe en vez de / además del número. Una por conversación,
-- complementa el score de survey_sends. Tabla aparte (aditiva) para que db:apply
-- la cree en instalaciones nuevas y viejas sin ALTER.
CREATE TABLE IF NOT EXISTS survey_open_responses (
  conversation_id TEXT PRIMARY KEY,
  response_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_survey_open_time ON survey_open_responses(created_at);

-- Cobros por WhatsApp (superpoder Pro) - un link de pago de Stripe por cobro.
-- status: pending | paid | canceled. El webhook de Stripe marca paid_at y avisa
-- al dueño. amount en la unidad menor (centavos). provider_id = Stripe id.
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_id TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_provider ON payment_intents(provider_id);

-- Envíos de campañas (free-form dentro de ventana / plantilla HSM fuera)
-- El UNIQUE es el candado anti-doble-envío por campaña
CREATE TABLE IF NOT EXISTS template_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  template_sid TEXT,
  sent_at INTEGER NOT NULL,
  UNIQUE (campaign_key, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_template_sends_time ON template_sends(sent_at);

-- Funciones/mejoras que los usuarios piden para Forja (recopilación desde el
-- bot de Instagram, gated por FEATURE_MODE="on"). Una fila por sugerencia.
CREATE TABLE IF NOT EXISTS forja_features (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  feature TEXT NOT NULL,
  motivo TEXT,
  nombre TEXT,
  status TEXT DEFAULT 'new',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_forja_features_time ON forja_features(created_at);

-- Archivos de las conversaciones (imágenes, audios, documentos) en el R2 del
-- miembro (binding MEDIA). Solo se llena si el binding existe. r2_key = la
-- llave en R2. El panel los sirve tras su auth (GET /admin/media/:id) y el
-- inbox móvil por GET /api/media/:id — nunca públicos.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',
  mime TEXT,
  filename TEXT,
  caption TEXT,
  bytes INTEGER,
  created_at INTEGER NOT NULL,
  -- Hilo del inbox móvil: a qué mensaje pertenece (NULL en filas viejas → se
  -- intercalan por timestamp), en qué dirección viajó y cuánto dura el audio.
  -- En bots YA instalados las agrega ensureMediaTable con ALTER: `forjabot
  -- update` no re-ejecuta este archivo.
  message_id TEXT,
  direction TEXT DEFAULT 'in',
  duration_s REAL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_media_conv ON media(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_time ON media(created_at);

-- Libera conversaciones amarradas a un ticket resuelto o a un id de ticket que ya
-- no existe. Idempotente (seguro en cada db:apply). Mismo statement que
-- TicketsRepo.cleanupStaleOpenTicketRefs.
UPDATE conversations SET open_ticket_id = NULL
WHERE open_ticket_id IS NOT NULL
  AND (open_ticket_id NOT IN (SELECT id FROM tickets)
       OR open_ticket_id IN (SELECT id FROM tickets WHERE status = 'resolved'));
