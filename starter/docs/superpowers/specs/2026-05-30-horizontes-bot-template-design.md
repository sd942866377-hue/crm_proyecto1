# Horizontes Bot Template — Design Spec

**Status**: Approved for implementation planning
**Date**: 2026-05-30
**Author**: Santiago Muñoz (w/ Claude Opus 4.7)
**Branch**: `feat/horizontes-bot-template`
**Future repo**: `santmun/horizontes-bot-template` (to be split into Free + Pro variants)
**Spec derived from**: Testivora support bot pattern (`docs/superpowers/specs/2026-05-26-support-chatbot-design.md`), adapted as multi-tenant boilerplate.

---

## 1. Problem & Goal

Members of the Horizontes IA Skool community (600+ LATAM, mostly non-technical SMB owners and freelance creators) want AI chatbots for their businesses — but every existing alternative is either too expensive (Intercom, Drift), too generic (off-the-shelf ChatGPT clones), or too hard to set up. The Testivora support bot we built proved the pattern works; this project productizes it as a **distributable template** members can deploy in 30 minutes to their own Cloudflare account.

**Goal**: ship a GitHub template repo + Claude Code skill that lets a non-technical Skool member go from "I want a chatbot" to "my bot is live answering customers on Telegram" in ≤30 minutes wall-clock, with channel + tool + language fully configurable, deployed entirely to the member's own Cloudflare account (zero infra responsibility on Santi's side).

**Anti-goals** (explicit decisions):
- Santi does NOT host members' bots — distributed deployment only.
- Santi does NOT charge per-bot revenue — value capture is via Skool membership retention.
- v1 does NOT support voice OUTPUT, Chatwoot, Meta Cloud API directo, or marketplace of templates (deferred to v1.5/v2).

---

## 2. Audience & Distribution Model

### 2.1 Audience profile

| Variable | Value |
|---|---|
| Geography | LATAM (mostly MX, CO, AR, PE, CL; some ES) |
| Technical level | Low. Most have never run `wrangler` or used a terminal. Some have used Notion / Airtable. |
| Business type | SMB service businesses: barbería, salón, restaurante, dentista, coach, inmobiliaria, tienda online, agencia. |
| Customer-facing channels | WhatsApp Business (dominant), Instagram DM, Messenger, Telegram (growing). Cero web widget en v1. |
| Existing tools | ManyChat (very common in LATAM), Google Sheets, Notion, Cal.com (growing), WhatsApp Business app. |

### 2.2 Two-tier distribution

| | **Free** | **Pro** |
|---|---|---|
| Audience | Skool levels 1-2 | Skool levels 3-5 |
| Gating | Public repo, public skill | Password on `horizontesia.com/bot-pro`; private repo or password-distributed |
| Multi-bot per member | ✗ (1 bot per member) | ✓ (unlimited bots) |
| License | MIT | Apache 2.0 + no-resale-as-competing-product clause |

### 2.3 Acquisition → retention funnel

```
Skool level 1-2 member
  → sees Santi's post / video
  → downloads /configurar-mi-chatbot (public skill)
  → has Free bot live in 30 min (Telegram + FAQ)
  → uses it 1-2 weeks, hits ceiling (no leads, no booking, no IG/WA)
  → upgrades Skool to level 3+ → password to Pro unlocked
  → runs /actualizar-a-pro (migrates Free→Pro in place, preserves D1)
  → has captureLead + scheduleAppointment + multi-channel + dashboard
```

Layer 3 (premium add-ons: managed hosting, workshops, consulting) is deferred to v2.

---

## 3. Architecture

### 3.1 Topology

```
Customer DM (IG / WA / Telegram / Messenger)
  ↓
Provider (ManyChat / Telegram / Twilio)
  ↓ POST webhook
┌────────────────────────────────────────────────────┐
│ Member's Cloudflare Worker (`bot-<slug>.workers.dev` │
│                              or custom domain)      │
│                                                      │
│   Hono router:                                       │
│     /webhooks/manychat  ─┐                          │
│     /webhooks/telegram  ─┼─→ parse channel adapter  │
│     /webhooks/twilio    ─┘                          │
│         ↓                                            │
│   env.AGENT.idFromName(channel + ":" + user_id)     │
│         ↓                                            │
│   ┌────────────────────────────────────────────┐   │
│   │ SupportAgent (Durable Object — 1/customer) │   │
│   │   - 15s message buffer (DO alarm)          │   │
│   │   - Load history from D1 (last 20 msgs)    │   │
│   │   - streamText(Haiku 4.5, tools)           │   │
│   │   - Sonnet 4.6 auto-upgrade for complex    │   │
│   │   - Chunker partitions reply               │   │
│   │   - Persist back to D1                     │   │
│   └────────────────────────────────────────────┘   │
│         ↓                                            │
│   Sender (typing indicator + 0.8-1.5s delays)       │
│         ↓                                            │
│   Provider HTTP API → Customer                      │
│                                                      │
│   /admin/* — Pro Dashboard (Hono + HTMX server-     │
│              rendered, magic link auth via Resend)  │
└────────────────────────────────────────────────────┘
        │              │            │             │
        ↓              ↓            ↓             ↓
   D1 (SQLite)    Vectorize      R2 (catalog   Workers AI
   - conversations  - KB chunks    images)      (Whisper +
   - messages       - 1024-dim                   BGE embed)
   - leads
   - tickets
   - admin_emails
```

### 3.2 Why Cloudflare Agents SDK (DO per user) over stateless

Member-side justification for the DO-per-user model:
- **Message buffer** (15s default) needs alarm-based dedup → DO `setAlarm()` is the native primitive
- **Per-customer state** (paused_until, last response time) lives natively in DO state, not in D1 hot path
- **Future scheduled actions** (follow-up if customer didn't reply in 24h) come for free
- **Reuses Testivora pattern** Santi already validated in production

### 3.3 Trust & infrastructure boundaries

- Member's CF account owns: Worker, DO, D1, Vectorize, R2, secrets (Anthropic, provider tokens, Resend)
- Santi's responsibility: GitHub repo content + skill content + Skool community support
- Santi does NOT have: read access to any member's data, ability to deploy/redeploy member's Worker, billing relationship for member's infra

---

## 4. Components

### 4.1 File structure

```
horizontes-bot-template/
├── README.md
├── wrangler.toml            # template w/ {{PLACEHOLDERS}}
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts             # Hono router, webhook entry, DO routing
│   ├── agent.ts             # SupportAgent extends Agent<Env, State>
│   ├── system-prompt.ts     # bilingual, customizable per member
│   ├── pricing.ts           # Anthropic + Workers AI rates (for dashboard cost calc)
│   ├── channels/
│   │   ├── manychat.ts      # parse + format for ManyChat
│   │   ├── telegram.ts      # parse + format for Telegram Bot API
│   │   ├── twilio.ts        # parse + format for Twilio WhatsApp
│   │   └── shared.ts        # IncomingMessage / OutgoingMessage types
│   ├── tools/
│   │   ├── searchKb.ts
│   │   ├── handoffHuman.ts
│   │   ├── pauseBot.ts
│   │   ├── captureLead.ts        # Pro
│   │   ├── scheduleAppointment.ts # Pro (Cal.com)
│   │   └── catalogQuery.ts        # Pro
│   ├── replies/
│   │   ├── chunker.ts        # naturally splits text into 2-3 short messages
│   │   └── sender.ts         # typing indicator + delays + channel send
│   ├── media/
│   │   ├── transcribe.ts     # Whisper input (audio → text)
│   │   └── vision.ts         # passes images to Haiku multimodal
│   ├── kb/
│   │   ├── reindex.ts        # BGE embeddings → Vectorize
│   │   └── docs/             # member's markdowns (NOT touched on update)
│   ├── db/
│   │   ├── schema.sql
│   │   ├── conversations.ts
│   │   ├── messages.ts
│   │   ├── leads.ts
│   │   └── tickets.ts
│   ├── admin/
│   │   ├── auth.ts           # magic link via Resend
│   │   ├── routes.ts         # Hono routes for /admin/*
│   │   ├── views/            # HTMX HTML templates
│   │   └── static/           # minimal CSS (Tailwind utilities inlined)
│   └── config.ts             # business info, language, tier, buffer time
├── member/                   # NEVER touched on `/actualizar-mi-bot`
│   ├── kb/                   # member's KB markdowns
│   ├── system-prompt.local.ts # member overrides (optional)
│   └── config.local.ts       # member config (business info)
└── skill/                    # Claude Code skill source
    ├── configurar-mi-chatbot.md       # the main skill file (Claude reads this)
    ├── actualizar-mi-bot.md           # update skill
    └── references/                    # supporting docs the skill loads on demand
        ├── nicho-templates/            # one .md per nicho (barbería, restaurante, etc)
        ├── channel-setup-guides/       # ManyChat/Telegram/Twilio step-by-steps
        └── troubleshooting.md          # common errors and fixes

**Decision**: skill lives in the SAME template repo at `/skill/`. When a member
clones the repo, the skill comes inside. Distribution is "clone repo →
copy `/skill/configurar-mi-chatbot.md` to `~/.claude/skills/`". No second repo.
```

**Critical separation**: `src/` is template code (overwritten on update via `/actualizar-mi-bot`). `member/` is member-owned and never touched by updates.

### 4.2 Channel adapter contract

Every channel adapter exports the same interface:

```typescript
export interface ChannelAdapter {
  // Parse provider's webhook payload into a normalized message
  parseIncoming(request: Request, env: Env): Promise<IncomingMessage>;
  
  // Format and send a reply (or multiple chunks) back to the provider
  sendReply(reply: OutgoingReply, env: Env): Promise<void>;
  
  // (Optional) Show typing indicator if channel supports it
  showTyping?(channelUserId: string, env: Env): Promise<void>;
  
  // Detect if a webhook is FROM the business owner (not customer) — for auto-pause
  isOwnerMessage(payload: any): boolean;
}

export interface IncomingMessage {
  channel: "manychat" | "telegram" | "twilio";
  channelUserId: string;       // WA number, Telegram user_id, etc.
  displayName?: string;
  text?: string;
  audioUrl?: string;           // if voice note
  imageUrl?: string;           // if image attachment
  receivedAt: number;
}

export interface OutgoingReply {
  channel: string;
  channelUserId: string;
  chunks: string[];            // already split by chunker
  inter_chunk_delay_ms?: number; // default 800-1500ms
}
```

### 4.3 Tool definitions matrix

| Tool | Free | Pro | Inputs | External dep | Notes |
|---|:-:|:-:|---|---|---|
| `searchKb` | ✓ | ✓ | `query: string` | Vectorize (member's CF) | Top-5 chunks, threshold 0.7 to be useful |
| `handoffHuman` | ✓ | ✓ | `reason, summary` | Resend (member's key) | Email to owner + ticket row in D1 |
| `pauseBot` | ✓ | ✓ | `duration_minutes` | none | Sets `paused_until` in D1 |
| `captureLead` | ✗ | ✓ | `name?, contact?, intent, notes?` | Google Sheets / Notion / Airtable (optional) | Always rows in D1; export to external service optional |
| `scheduleAppointment` | ✗ | ✓ | `date, time, service, client_name, client_contact` | Cal.com API key | Creates Cal.com event |
| `catalogQuery` | ✗ | ✓ | `productName` | Google Sheets or D1 catalog | Returns product details |
| `transcribeAudio` | ✓ | ✓ | `audioUrl` | Workers AI (free) | Internal — called auto when voice received |
| `viewImage` | ✗ | ✓ | `imageUrl, caption?` | Anthropic vision | Internal — Haiku multimodal call |

---

## 5. Data Model (D1 schema)

```sql
-- Conversations: one per (channel, channel_user_id) customer
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,              -- "manychat:5511234567"
  channel TEXT NOT NULL,            -- 'manychat' | 'telegram' | 'twilio'
  channel_user_id TEXT NOT NULL,
  display_name TEXT,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  paused_until INTEGER,             -- if owner intervened
  open_ticket_id TEXT,              -- FK if currently escalated
  metadata TEXT                     -- JSON: provider-specific fields
);
CREATE UNIQUE INDEX idx_conv_unique ON conversations(channel, channel_user_id);
CREATE INDEX idx_conv_last_msg ON conversations(last_message_at);

-- Messages: 90-day rolling window (cron-purged)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'user' | 'assistant' | 'tool' | 'owner'
  content TEXT NOT NULL,
  tool_calls TEXT,                  -- JSON of tool_use blocks
  model_used TEXT,                  -- 'claude-haiku-4-5-20251001' etc.
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  audio_seconds REAL,               -- if input was voice (for Whisper cost)
  image_count INTEGER,              -- if input had images
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX idx_msg_conv_created ON messages(conversation_id, created_at);
CREATE INDEX idx_msg_created ON messages(created_at);

-- Leads: never auto-purged
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  name TEXT,
  contact TEXT,                     -- phone or email
  channel_user_id TEXT,             -- always preserved (provider-side ID)
  intent TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'new',        -- 'new' | 'contacted' | 'sold' | 'lost'
  exported_to TEXT,                 -- 'google_sheets' | 'notion' | 'airtable' | NULL
  external_id TEXT,                 -- external system row id if exported
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at);

-- Tickets: escalations to human (owner)
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  category TEXT,                    -- 'billing' | 'product' | 'complaint' | 'other'
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  status TEXT DEFAULT 'open',       -- 'open' | 'in_progress' | 'resolved'
  resolved_at INTEGER,
  resolved_by TEXT,                 -- owner email
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX idx_tickets_status ON tickets(status);

-- Admin emails (dashboard auth allowlist)
CREATE TABLE admin_emails (
  email TEXT PRIMARY KEY,
  role TEXT DEFAULT 'owner',        -- 'owner' | 'staff'
  added_at INTEGER NOT NULL
);

-- Magic link tokens (short-lived)
CREATE TABLE magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,      -- 15 minutes
  used_at INTEGER
);
CREATE INDEX idx_magic_email ON magic_links(email);
CREATE INDEX idx_magic_expires ON magic_links(expires_at);

-- KB chunks live in Vectorize (not D1) — Vectorize index `kb_chunks` w/ 1024-dim embeddings
```

### 5.1 Retention & GDPR

- **Messages**: auto-purged after 90 days via daily Worker cron
- **Leads**: never auto-purged (business data)
- **Tickets**: never auto-purged
- **Export**: dashboard "Export CSV" button on Leads + Tickets + Conversations tabs
- **Delete-me**: dashboard "Delete Customer" button — hard-deletes a customer's conversation + messages + revokes the lead if requested

---

## 6. Agent core behavior (system prompt + flow)

### 6.1 Message buffer (15s default, configurable)

```
T+0s    Customer message arrives → DO.onMessage()
        DO appends to in-memory buffer
        DO calls ctx.storage.setAlarm(now + 15s)

T+5s    Another message arrives
        DO appends to buffer
        DO calls ctx.storage.setAlarm(now + 15s) (resets timer)

T+20s   Alarm fires (no messages in last 15s)
        DO processes buffer as single concatenated input
        Sends to Claude with full conversation history (last 20 msgs from D1)
```

Configurable in `member/config.local.ts`:
```typescript
export const config = {
  bufferSeconds: 15,
  // ...
}
```

### 6.2 Chunked replies (natural pacing)

`replies/chunker.ts` partitions Claude's response by:
1. Paragraph breaks (highest priority)
2. Sentence boundaries (if paragraph too long)
3. Max 3 chunks per reply (avoid bot spam feel)

Each chunk sent with:
- Typing indicator (channel-permitting): Telegram ✓, Twilio ✓, ManyChat partial
- Delay 800-1500ms between chunks (proportional to chunk length: ~30ms per character, capped)

### 6.3 Auto-pause when owner intervenes

When the owner sends a message through their own WhatsApp/Telegram to a customer (detected by `ChannelAdapter.isOwnerMessage()`):
- `conversation.paused_until = now + 60min`
- Bot will not respond to further messages from that customer until window expires
- Owner can also click "Devolver al bot" in dashboard to expire pause early

### 6.4 Auto-upgrade Haiku → Sonnet for complex queries

Internal heuristic in `agent.ts` (NOT a tool Claude can call). Before each LLM call, the agent inspects the conversation state and selects model:

```typescript
function selectModel(state: AgentState, msg: IncomingMessage): "haiku" | "sonnet" {
  // Default: Haiku 4.5
  // Upgrade to Sonnet 4.6 when ANY of:
  if (state.toolCallsInLast2Turns > 3) return "sonnet";            // multi-step diagnostic
  if (containsFrustrationKeywords(state.lastUserMsg)) return "sonnet";  // emotional escalation
  if (msg.imageUrl && state.imageRetryCount > 0) return "sonnet";  // vision retry after Haiku low confidence
  if (state.lastSearchKbScore < 0.5) return "sonnet";              // KB miss → harder reasoning
  return "haiku";
}
```

Frustration keywords (per language): "broken", "nothing works", "no sirve", "horrible", "no funciona", "está mal", etc. — list lives in `src/agent.ts:FRUSTRATION_KEYWORDS_BY_LANG`.

Default blend at typical SMB volume: ~90% Haiku, ~10% Sonnet (matches Testivora's observed cost profile).

### 6.5 System prompt (template)

The system prompt has these sections (bilingual w/ `{{USER_LANGUAGE}}` placeholder, like Testivora):

1. `<output_language>` — CRITICAL override
2. `<role>` — bot is named `{{BOT_NAME}}` for business `{{BUSINESS_NAME}}`
3. `<business_context>` — `{{BUSINESS_DESCRIPTION}}`, services, hours, location
4. `<identity_and_voice>` — tone (warm/direct/premium per Horizontes IA brand)
5. `<core_principles>` — diagnose with data, one question at a time, escalate early
6. `<tools>` — descriptions of available tools (subset by tier)
7. `<diagnostic_playbooks>` — per-vertical (skill picks: barbería / restaurante / dentista / etc.)
8. `<escalation_rules>` — when to call handoffHuman
9. `<style_guide>` — markdown rules, no emojis (except ✓ for booking confirms), short replies
10. `<anti_patterns>` — never invent features, never share owner contact unless asked

The skill generates this from member's responses + nicho template.

### 6.6 Voice input flow

```
Customer voice note → Provider webhook with audioUrl
  ↓
ChannelAdapter.parseIncoming extracts audioUrl
  ↓
media/transcribe.ts:
  audio = await fetch(audioUrl).then(r => r.arrayBuffer())
  result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio })
  text = result.text
  ↓
DO processes `text` as if it were a text message
  ↓
Bot replies in TEXT (not audio) — voice OUTPUT deferred to v2
```

Cost: Workers AI free tier (10K Neurons/day) covers ~10 hours of audio/day. Member-level Pareto: <1 hour/month for typical SMB.

### 6.7 Image input flow (Pro only)

```
Customer image → Provider webhook with imageUrl
  ↓
ChannelAdapter.parseIncoming extracts imageUrl
  ↓
media/vision.ts:
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { url: imageUrl } },
      { type: "text", text: customer.caption ?? "(no caption)" }
    ]
  }]
  ↓
Claude Haiku 4.5 processes image + text natively
  ↓
Bot replies based on image content (e.g., "Veo el corte de tu referencia — fade alto + barba marcada. $400.")
```

Tier gate: skill `tier === "pro"` enables this. Free tier strips images before processing and tells customer "vista de imágenes no disponible en este plan".

---

## 7. Dashboard Pro (`/admin/*`)

### 7.1 Auth (magic link via Resend)

Flow:
1. Member visits `bot-hugo.workers.dev/admin`
2. Sees email input
3. Submits email → server checks `admin_emails` table → if allowlisted, generates token + stores in `magic_links` (15min TTL)
4. Resend sends email with link `bot-hugo.workers.dev/admin/auth?token=xyz`
5. Member clicks → server validates token → sets cookie (HMAC-signed session) → redirect to `/admin/overview`

Setup: skill stores owner's email as the initial admin during setup. Owner can add more from `/admin/config`.

### 7.2 Six tabs

| Tab | Purpose | Key data sources |
|---|---|---|
| **Overview** | "today" + "this month" stats + bot health | aggregated D1 queries |
| **Statistics** | usage by day (30d), tools usage, channel distribution, hour heatmap | D1 messages table |
| **Conversations** | recent conversations w/ search, click to see full history | D1 conversations + messages |
| **Leads** | captured leads table, export CSV, mark sold/contacted, send to external service | D1 leads |
| **Tickets** | escalated tickets, click to reply in channel or mark resolved | D1 tickets |
| **Config** | edit business info, services, hours, buffer, language, admins, integrations | D1 + `member/` files (via skill or direct config endpoint) |

### 7.3 Stack

- **Hono** routes under `/admin/*`
- **HTMX** for interactivity (no React, no client-side build)
- **Tailwind utilities** inlined in a single `.css` file served by the Worker (no build step)
- **Mobile-first responsive** — most members will check from phone
- **No dark mode** in v1 (deferred to v1.5)

---

## 8. Skill Workflow (`/configurar-mi-chatbot`)

### 8.1 Eight-step flow

| Step | What the skill asks | What the skill does |
|---|---|---|
| 1 | Business name, description, city, website, contact email | stores in `member/config.local.ts` |
| 2 | What tasks does the bot do? (FAQ ✓, leads ✓, booking ✓, catalog ✓) | enables/disables tools by tier |
| 3 | Language? (ES MX / ES ES / EN / PT BR / multilingual / other) | sets `BOT_LANGUAGE` placeholder in system prompt |
| 4 | Channels? (Telegram ✓, ManyChat ✓, Twilio ✓) | for each, runs sub-flow that creates bot via provider API + saves token as wrangler secret |
| 5 | Escalation channels? (email, WA to owner, Notion ticket, etc.) | configures `handoffHuman` tool routing |
| 6 | Initial KB content (hours, services+prices, location, payment methods) | generates 5 seed markdowns in `member/kb/` |
| 7 | Cloudflare account: existing or create | opens browser for `wrangler login`; creates D1 / Vectorize / R2 namespaces |
| 8 | Deploy + connect webhooks | `wrangler deploy`; generates webhook URLs; auto-configures Telegram via `setWebhook`; outputs URLs for member to paste in ManyChat dashboard |

### 8.2 Multi-bot support

After step 1, skill detects existing bots in member's directory:
- If `.bot-state.json` exists → asks "¿Es un bot nuevo o actualizar el existente?"
- New bot → asks for unique `BOT_SLUG` → creates separate folder + separate CF Worker
- Update → routes to `/actualizar-mi-bot` flow

### 8.3 Setup interruption handling

Skill writes state checkpoints to `.bot-setup.json` after each step:
```json
{
  "step": 4,
  "completed": ["business_info", "tasks", "language", "telegram"],
  "pending": ["manychat", "escalation", "kb", "cloudflare", "deploy"],
  "started_at": 1748390000
}
```

If member runs skill again, it detects the file and asks "¿Reanudar desde el paso 5 o empezar de cero?"

### 8.4 Wrangler login automation

Skill runs `wrangler login` which opens the browser for OAuth. Member confirms in browser, skill captures success via wrangler CLI output. No skill-side OAuth — wrangler handles it.

### 8.5 Google Service Account handling (for Sheets export)

If member chooses Google Sheets export:
- Skill walks them through Google Cloud Console → create service account → download JSON
- Member pastes JSON content into the terminal
- Skill base64-encodes and stores via `wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`

---

## 9. Update Workflow (`/actualizar-mi-bot`)

```
$ /actualizar-mi-bot

1. Detect current version (read .bot-version from member dir)
2. Fetch upstream latest (git fetch from horizontes-bot-template)
3. Display changelog: v1.3.2 → v1.5.0
4. Validate member's Skool level via Santi's API (POST email + bot_id)
   - If level < required for new features → degrade gracefully (don't include new files)
5. Detect modifications in src/ (which we don't expect)
   - If modified: warn + offer overwrite or skip
6. git pull --strategy=ours-on-member-paths (preserves member/ + member changes elsewhere)
7. pnpm install (if deps changed)
8. Run any DB migrations (schema.sql diff applied)
9. wrangler deploy
10. Verify bot still healthy (POST /health)
```

Member always retains: `member/` folder, secrets, D1 data, Vectorize index.

---

## 10. Tier feature matrix (canonical)

| Feature | Free | Pro |
|---|:-:|:-:|
| Channels: Telegram | ✓ | ✓ |
| Channels: ManyChat | ✗ | ✓ |
| Channels: Twilio WhatsApp | ✗ | ✓ |
| Tool: searchKb (FAQ from docs) | ✓ | ✓ |
| Tool: handoffHuman (email) | ✓ | ✓ |
| Tool: pauseBot | ✓ | ✓ |
| Tool: captureLead | ✗ | ✓ |
| Tool: scheduleAppointment (Cal.com) | ✗ | ✓ |
| Tool: catalogQuery | ✗ | ✓ |
| Voice input (Whisper) | ✓ | ✓ |
| Image input (Haiku vision) | ✗ | ✓ |
| Auto-upgrade Haiku → Sonnet | ✗ | ✓ |
| Multi-language (auto-detect EN/ES in conv) | ✗ | ✓ |
| Buffer (configurable) | fixed 15s | 5-60s configurable |
| Reply chunking (typing indicator + delays) | ✓ | ✓ |
| Auto-pause when owner intervenes | ✓ | ✓ |
| Dashboard | ✗ | ✓ |
| Magic link auth (multi-admin) | ✗ | ✓ |
| Stats: usage / costs / tools breakdown | ✗ | ✓ |
| Handoff: email + ticket in D1 | ✓ | ✓ |
| Handoff: WhatsApp DM to owner (Twilio) | ✗ | ✓ |
| Handoff: co-pilot mode (bot suggests while owner types) | ✗ | ✓ |
| Handoff: return-to-bot w/ conversation summary | ✗ | ✓ |
| Export: CSV (leads, tickets, convs) | ✗ | ✓ |
| Export: Google Sheets / Notion / Airtable for leads | ✗ | ✓ |
| Multi-bot per member | ✗ | ✓ |
| Skill: `/actualizar-mi-bot` automated | ✗ | ✓ |
| KB nicho templates available | barbería, restaurante (2) | + dentista, coach, tienda, inmobiliaria, salón, gimnasio, panadería (9 total) |

---

## 11. Costs

### 11.1 Member-side (typical examples)

**Free tier, barbería with 200 msgs/mo on Telegram**:
| Item | Cost/mo |
|---|---:|
| Cloudflare (free tier — 100K req/day) | $0 |
| D1 (free 5M reads/mo) | $0 |
| Vectorize | <$0.10 |
| Anthropic Haiku (~200 turns w/ 90% cache) | ~$0.40 |
| Telegram Bot API | $0 |
| Workers AI Whisper (50 voice notes/mo, ~30s each) | $0 |
| **Total Free** | **~$0.50/mo** |

**Pro tier, panadería with 1500 msgs/mo on ManyChat + Telegram, ~50 image queries**:
| Item | Cost/mo |
|---|---:|
| Cloudflare (still free tier) | $0 |
| D1 + Vectorize | <$0.50 |
| Anthropic Haiku + 10% Sonnet | ~$4 |
| Anthropic image processing (50 images) | ~$0.02 |
| ManyChat (member's plan) | $15-30 |
| Cal.com (optional, free tier sufficient) | $0-12 |
| Resend (free 100/day) | $0 |
| Workers AI Whisper | $0 |
| Twilio WA outbound (handoff to owner ~50/mo) | ~$0.05 |
| **Total Pro** | **$20-50/mo** |

### 11.2 Santi-side

| Item | Cost |
|---|---:|
| Hosting `horizontesia.com/bot-free` and `/bot-pro` pages | $0 (existing landing) |
| GitHub repos (free) | $0 |
| Build time (his + Claude's) | one-time, ~5 weeks |
| Ongoing maintenance + support | his time only |
| Revenue (direct) | $0 (perk de membership Skool) |

---

## 12. Testing & Rollout

### 12.1 Test tiers

1. **Unit**: channel parsers, chunker, buffer alarm logic, tool handlers (mocked external APIs)
2. **Integration**: Worker + DO + D1 via Miniflare; webhook simulation
3. **LLM eval**: 20 EN/ES/PT scenarios w/ Sonnet 4.6 judge; ≥85% threshold
4. **E2E manual**: fresh CF account → run skill → bot live on Telegram in ≤30 min

### 12.2 Rollout phases

| Phase | Audience | Duration | Advancement criteria |
|---|---|---|---|
| 0 | Santi only | 3 days | Bot tests work on Telegram |
| 1 | 3 alpha testers (level 5) | 1 week | All 3 complete setup unaided; ≤2 blocker bugs found |
| 2 | Level 4-5 beta (~20 members) | 2 weeks | NPS ≥8; <30% need direct support |
| 3 | GA Pro (level 3+) | 2 weeks | Setup median <40min; tickets/msgs <10% |
| 4 | Free public (level 1+) | Permanent | — |

### 12.3 Launch motion

- Pre-launch: 5-min YouTube demo, README w/ screenshots, pinned Skool post
- Launch day: live workshop (60min: 30 walkthrough + 30 Q&A); recorded for archive
- Week 1-2: daily `#bot-help` Skool channel monitoring (1-2 hrs/day Santi)
- Ongoing: bi-weekly patch releases via `/actualizar-mi-bot`

### 12.4 Success metrics

- # bots deployed (GitHub clone analytics)
- % members who complete skill end-to-end
- Median setup time (opt-in telemetry)
- Skool level 1→3 conversion delta vs control
- Skool level 3+ churn delta vs control
- Tickets per active bot per week

---

## 13. Explicit non-goals (v1)

- ❌ Web widget (decided: API-first only, social channels)
- ❌ Voice OUTPUT (TTS) — bot replies in text only
- ❌ Bot-to-bot handoff between members
- ❌ Marketplace of templates (members publish nicho templates) — v2.5
- ❌ Meta Cloud API directo — v1.5
- ❌ Chatwoot adapter — v2
- ❌ Centralized analytics for Santi (he can't see members' usage)
- ❌ Multi-tenant hosting by Santi — distributed only
- ❌ Sentry / error tracking pre-configured — wrangler tail only in v1
- ❌ Dark mode dashboard — v1.5

---

## 14. Roadmap

| Release | Features | Target month |
|---|---|---|
| **v1** | Free + Pro core, ManyChat + Telegram + Twilio, voice input, image input (Pro), dashboard | Month 1 |
| **v1.5** | Meta Cloud API directo, Sentry opt-in, dark mode dashboard | Month 2 |
| **v2** | Chatwoot, voice OUTPUT (TTS), multi-language auto-detect, webhooks outbound (Slack/Discord notifications) | Month 3-4 |
| **v2.5** | Marketplace of nicho templates (member-published) | Month 5-6 |
| **v3** | Bot-to-bot handoff, scheduled actions (follow-ups, cron campaigns) | Month 6+ |

---

## 15. Open implementation questions (deferred to writing-plans)

1. Exact Hono router structure (single file vs split per route group)
2. DO state shape (in-memory only vs cached subset of D1)
3. Skill packaging (single skill file vs multi-file skill with sub-flows)
4. Repo split: monorepo with `/free` and `/pro` branches vs two separate repos
5. Webhook signature validation per channel (security hardening details)
6. Rate limiting strategy (per-IP / per-customer / per-bot)
7. Bot health endpoint contract (`/health` response shape)

These get specified in the implementation plan.

---

## Appendix A — System prompt structure (template)

```
<output_language>
The bot replies in: {{USER_LANGUAGE}}
[mirror of Testivora's pattern w/ RIGHT/WRONG examples]
</output_language>

<role>
Eres {{BOT_NAME}}, el asistente de {{BUSINESS_NAME}} ({{BUSINESS_TYPE}}).
Tu misión: ayudar al cliente con eficiencia + calidez, sin nunca inventar.
</role>

<business_context>
{{BUSINESS_DESCRIPTION}}
{{SERVICES_AND_PRICES}}
{{HOURS}}
{{LOCATION}}
{{PAYMENT_METHODS}}
</business_context>

<identity_and_voice>
[Horizontes IA brand voice: warm, direct, premium, no buzzwords]
</identity_and_voice>

<core_principles>
[5 principles mirrored from Testivora]
</core_principles>

<tools>
[Subset by tier: searchKb, handoffHuman, pauseBot for Free;
 + captureLead, scheduleAppointment, catalogQuery for Pro]
</tools>

<diagnostic_playbooks>
[Nicho-specific playbooks injected by skill: barbería template includes
 "agendar corte", "consultar precio servicio", "horario hoy", etc.]
</diagnostic_playbooks>

<escalation_rules>
[When to call handoffHuman: out-of-scope, frustration, explicit request]
</escalation_rules>

<style_guide>
[Markdown rules, no headers, brief replies, no emojis except ✓ confirms]
</style_guide>

<anti_patterns>
[Never invent prices/hours/services not in business_context.
 Never share owner contact without explicit request.
 Never claim actions you didn't take.]
</anti_patterns>
```

---

## Appendix B — License terms

**Free repo**: MIT License. Anyone can clone, modify, deploy, commercial use ✓, redistribute ✓.

**Pro repo**: Apache 2.0 License with appended clause:
> "Notwithstanding the Apache 2.0 grant, you may not redistribute this Software, in whole or in part, as a standalone product or service that competes directly with Horizontes IA Bot Template. Use of this Software for client work or consulting on behalf of paying clients IS permitted."

---

End of design spec.
