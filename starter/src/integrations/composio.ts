import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

/**
 * Cliente de Composio (composio.dev) — conecta el bot con CUALQUIER app que el
 * miembro haya vinculado en su cuenta de Composio (Google Calendar, Gmail,
 * Slack, Notion, CRMs…) sin escribir código por app. Dos capacidades:
 *  - listConnectedTools: auto-descubre qué apps conectó (toolkits) y trae un
 *    catálogo curado de sus tools (slug + descripción) para anunciar al LLM.
 *  - executeComposioTool: ejecuta una tool por slug con argumentos, resolviendo
 *    sola la connected_account_id del toolkit dueño de esa tool.
 *
 * Verificación (probado EN VIVO con una API key real del dashboard de Composio):
 *  - Auth: header `x-api-key: <API_KEY>` — la key del DASHBOARD (Settings → API
 *    Keys), NO el token del CLI (`uak_…`, que la REST rechaza). v1 muerta (410).
 *  - Endpoints: GET /api/v3/connected_accounts, GET /api/v3.1/tools,
 *    POST /api/v3.1/tools/execute/{tool_slug}.
 *  - execute EXIGE `user_id` (entity) JUNTO con `connected_account_id` (error
 *    1811 si falta) y responde { data, successful, error, log_id }. Confirmado
 *    con GMAIL_GET_PROFILE → successful:true, data.emailAddress/messagesTotal.
 *  - TODO: si un toolkit tiene VARIAS cuentas ACTIVE para la misma entity, usa
 *    la primera. Distintas entities se resuelven por el user_id de cada cuenta.
 */

const API = "https://backend.composio.dev/api/v3";
const API_TOOLS = "https://backend.composio.dev/api/v3.1"; // docs: /tools y /tools/execute viven en v3.1

const MAX_TOOLKITS = 5; // no saturar el prompt con demasiadas apps conectadas
const MAX_TOOLS_PER_TOOLKIT = 6;
const MAX_TOOLS_TOTAL = 20;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min — corto para que una app recién conectada aparezca casi al instante, sin pegarle a Composio en cada turno

export interface ComposioTool {
  slug: string;
  description: string;
  toolkitSlug: string;
  // Nombres de los parámetros REQUERIDOS de la tool (del input_parameters.required
  // que trae Composio), para que el LLM sepa qué mandar sin adivinar. [] si la
  // tool no tiene requeridos o si no pudimos leer el schema.
  requiredParams: string[];
}

interface ComposioCache {
  fetchedAt: number;
  tools: ComposioTool[];
  accountByToolkit: Record<string, string>; // toolkit slug -> connected_account_id
  entityByToolkit: Record<string, string>; // toolkit slug -> user_id (entity) de esa cuenta
}

let cache: ComposioCache | null = null;

/** ¿El miembro conectó Composio? (tiene su API key guardada). */
export function composioEnabled(env: Env): boolean {
  return Boolean(env.COMPOSIO_API_KEY);
}

function authHeaders(env: Env): HeadersInit {
  return { "x-api-key": env.COMPOSIO_API_KEY as string, "Content-Type": "application/json" };
}

/**
 * Auto-descubre las apps conectadas (toolkits) del miembro y trae un catálogo
 * curado de sus tools (slug + descripción), listo para anunciar al LLM en el
 * system prompt. Cachea en memoria del isolate ~10 min para no pegarle a la
 * API de Composio en cada turno de cada conversación.
 */
export async function listConnectedTools(env: Env): Promise<ComposioTool[]> {
  if (!composioEnabled(env)) return [];
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.tools;

  try {
    const accounts = await fetchConnectedAccounts(env);
    if (accounts.length === 0) {
      cache = { fetchedAt: Date.now(), tools: [], accountByToolkit: {}, entityByToolkit: {} };
      return [];
    }

    const accountByToolkit: Record<string, string> = {};
    const entityByToolkit: Record<string, string> = {};
    for (const a of accounts) {
      // Si hay varias cuentas ACTIVE para el mismo toolkit, se queda con la
      // primera que aparezca (ver TODO arriba del archivo).
      if (!accountByToolkit[a.toolkitSlug]) {
        accountByToolkit[a.toolkitSlug] = a.id;
        entityByToolkit[a.toolkitSlug] = a.entity;
      }
    }

    const toolkitSlugs = Object.keys(accountByToolkit).slice(0, MAX_TOOLKITS);
    const tools: ComposioTool[] = [];
    for (const toolkitSlug of toolkitSlugs) {
      if (tools.length >= MAX_TOOLS_TOTAL) break;
      const toolkitTools = await fetchToolsForToolkit(env, toolkitSlug);
      tools.push(...toolkitTools.slice(0, MAX_TOOLS_PER_TOOLKIT));
    }

    cache = {
      fetchedAt: Date.now(),
      tools: tools.slice(0, MAX_TOOLS_TOTAL),
      accountByToolkit,
      entityByToolkit,
    };
    return cache.tools;
  } catch (e: any) {
    console.error("[composio] listConnectedTools failed:", e);
    // Fail-open con lo último bueno que teníamos (o vacío si nunca hubo cache).
    return cache?.tools ?? [];
  }
}

/**
 * Ejecuta una tool de Composio por slug (ej. "GOOGLECALENDAR_CREATE_EVENT").
 * Resuelve sola la connected_account_id del toolkit dueño de esa tool a partir
 * del catálogo cacheado; si el slug no está en el catálogo curado, hace una
 * consulta puntual para encontrar su toolkit antes de ejecutar.
 */
export async function executeComposioTool(
  env: Env,
  slug: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  if (!composioEnabled(env)) return { ok: false, error: "composio_not_configured" };

  try {
    if (!cache) await listConnectedTools(env);

    let toolkitSlug = cache?.tools.find((t) => t.slug === slug)?.toolkitSlug;
    if (!toolkitSlug) {
      toolkitSlug = (await fetchToolkitForSlug(env, slug).catch(() => null)) ?? undefined;
    }
    const connectedAccountId = toolkitSlug ? cache?.accountByToolkit[toolkitSlug] : undefined;
    // La API v3.1 EXIGE user_id (entity) JUNTO con connected_account_id (error
    // 1811 "ConnectedAccountEntityIdRequired" si falta). Se prefiere
    // COMPOSIO_ENTITY_ID; si no, el entity de la cuenta descubierta para ese
    // toolkit. Verificado en vivo con GMAIL_GET_PROFILE (successful:true).
    const entity =
      env.COMPOSIO_ENTITY_ID ||
      (toolkitSlug ? cache?.entityByToolkit[toolkitSlug] : undefined);

    const body: Record<string, unknown> = { arguments: args ?? {} };
    if (connectedAccountId) body.connected_account_id = connectedAccountId;
    if (entity) body.user_id = entity;

    const res = await fetch(`${API_TOOLS}/tools/execute/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as any;
    // Respuesta: { data, successful, error, log_id }. Un 200 con successful:false
    // SIGUE siendo error (verificado en vivo).
    if (!res.ok || json?.successful === false) {
      const raw = json?.error?.message || json?.error || `http_${res.status}`;
      return { ok: false, error: typeof raw === "string" ? raw : JSON.stringify(raw) };
    }
    return { ok: true, data: json?.data ?? json };
  } catch (e: any) {
    return { ok: false, error: `transient:${String(e?.message ?? e)}` };
  }
}

interface ConnectedAccountItem {
  id: string;
  toolkitSlug: string;
  entity: string; // user_id de la cuenta — la API lo exige al ejecutar
}

async function fetchConnectedAccounts(env: Env): Promise<ConnectedAccountItem[]> {
  // Camino normal INTACTO: el servidor filtra statuses=ACTIVE (mismo shape de
  // siempre) — cero riesgo para las apps que sí funcionan (Cal.com, etc.).
  const params = new URLSearchParams({ statuses: "ACTIVE", limit: "50" });
  if (env.COMPOSIO_ENTITY_ID) params.set("user_ids", env.COMPOSIO_ENTITY_ID);
  const res = await fetch(`${API}/connected_accounts?${params}`, { headers: authHeaders(env) });
  if (!res.ok) throw new Error(`connected_accounts http_${res.status}`);
  const body = (await res.json()) as {
    items?: Array<{ id: string; user_id?: string; toolkit?: { slug?: string } }>;
  };
  const active = (body.items ?? [])
    .filter((a): a is { id: string; user_id?: string; toolkit: { slug: string } } =>
      Boolean(a.toolkit?.slug),
    )
    .map((a) => ({ id: a.id, toolkitSlug: a.toolkit.slug, entity: a.user_id ?? "" }));

  // Diagnóstico SOLO cuando no hay ninguna activa: una consulta aparte SIN el
  // filtro de estado revela conexiones rotas (OAuth invalidado por el retiro del
  // 3-jul-2026: Gmail/Calendar/Slack quedan EXPIRED/INACTIVE; Cal.com por API key
  // sigue ACTIVE). No toca el camino normal → best-effort, nunca lanza.
  if (active.length === 0) {
    try {
      const p2 = new URLSearchParams({ limit: "50" });
      if (env.COMPOSIO_ENTITY_ID) p2.set("user_ids", env.COMPOSIO_ENTITY_ID);
      const r2 = await fetch(`${API}/connected_accounts?${p2}`, { headers: authHeaders(env) });
      const b2 = (await r2.json().catch(() => null)) as {
        items?: Array<{ status?: string; toolkit?: { slug?: string } }>;
      } | null;
      const all = b2?.items ?? [];
      if (all.length) {
        console.warn(
          "[composio] 0 conexiones ACTIVE pero hay estas — reconéctalas (Composio retiró el OAuth viejo 3-jul-2026):",
          all.map((a) => `${a.toolkit?.slug ?? "?"}=${a.status ?? "?"}`).join(", "),
        );
      }
    } catch {
      /* diagnóstico best-effort */
    }
  }
  return active;
}

async function fetchToolsForToolkit(env: Env, toolkitSlug: string): Promise<ComposioTool[]> {
  const params = new URLSearchParams({
    toolkit_slug: toolkitSlug,
    limit: String(MAX_TOOLS_PER_TOOLKIT),
    important: "true",
  });
  const res = await fetch(`${API_TOOLS}/tools?${params}`, { headers: authHeaders(env) });
  if (!res.ok) throw new Error(`tools http_${res.status}`);
  const body = (await res.json()) as {
    items?: Array<{
      slug: string;
      description?: string;
      human_description?: string;
      toolkit?: { slug?: string };
      // Verificado en vivo (GET /api/v3.1/tools y confirmado en la doc oficial
      // docs.composio.dev/reference/api-reference/tools/getTools): cada tool
      // trae `input_parameters` con forma de JSON Schema — { properties, required }.
      input_parameters?: { properties?: Record<string, unknown>; required?: string[] };
    }>;
  };
  return (body.items ?? []).map((t) => ({
    slug: t.slug,
    description: t.human_description || t.description || t.slug,
    toolkitSlug: t.toolkit?.slug ?? toolkitSlug,
    requiredParams: Array.isArray(t.input_parameters?.required) ? t.input_parameters.required : [],
  }));
}

/**
 * Lee el `composio_context` (setting D1) que el skill /conexiones-composio deja:
 * config por-tool que el dueño configuró — a qué base de Airtable, calendario
 * de Google Calendar, event_type de Cal.com, etc. apunta cada toolkit. Formato:
 * JSON `{ "<toolkit_slug>": { ...config } }`. Best-effort: nunca lanza; "" o
 * JSON inválido devuelve {}.
 */
export async function getComposioContext(env: Env): Promise<Record<string, unknown>> {
  try {
    const raw = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.composioContext);
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (e) {
    console.warn("[composio] getComposioContext failed:", e);
    return {};
  }
}

async function fetchToolkitForSlug(env: Env, slug: string): Promise<string | null> {
  const params = new URLSearchParams({ tool_slugs: slug, limit: "1" });
  const res = await fetch(`${API_TOOLS}/tools?${params}`, { headers: authHeaders(env) });
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: Array<{ toolkit?: { slug?: string } }> };
  return body.items?.[0]?.toolkit?.slug ?? null;
}

/** Solo para tests: limpia el cache en memoria entre casos. */
export function __resetComposioCacheForTests(): void {
  cache = null;
}
