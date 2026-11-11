/**
 * Tests for the "Mi Agente" tab: n8n-style canvas, node panels, and the tool
 * on/off toggle (settings.disabled_tools). Real D1 via miniflare; no LLM calls
 * happen in these routes (tool construction is side-effect free).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { ConversationsRepo } from "../../src/db/conversations";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  const b64 =
    typeof btoa === "function"
      ? btoa(raw)
      : Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };

let env: Env;
let settings: SettingsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
  settings = new SettingsRepo(new Db(d1));
});

describe("Mi Agente — page and canvas", () => {
  it("renders the canvas with the core nodes and the pro tools", async () => {
    const res = await adminApp.request("/agente", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Mi Agente");
    expect(html).toContain("Buffer");
    expect(html).toContain("Respuesta");
    expect(html).toContain("Modelo");
    expect(html).toContain("Memoria");
    // Pro tier: all six tools appear as nodes
    for (const tool of ["searchKb", "handoffHuman", "pauseBot", "captureLead", "scheduleAppointment", "catalogQuery"]) {
      expect(html).toContain(tool);
    }
    // Buffer shows the effective seconds from env
    expect(html).toContain("8 s");
  });

  it("shows real channels from the conversations table", async () => {
    const convs = new ConversationsRepo(new Db(env.DB));
    await convs.getOrCreate("telegram", "u1");
    const res = await adminApp.request("/agente/canvas", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("Telegram");
    expect(html).toContain("1 conversación");
  });

  it("requires auth", async () => {
    const res = await adminApp.request("/agente", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("Mi Agente — node panels", () => {
  it("brain panel shows the effective system prompt", async () => {
    const res = await adminApp.request("/agente/node/brain", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("prompt efectivo");
    // The rendered prompt itself is embedded (escaped) — role tag included:
    expect(html).toContain("&lt;role&gt;");
    expect(html).toContain("TestBot");
  });

  it("tool panel shows usage and the toggle button", async () => {
    const res = await adminApp.request("/agente/node/tool%3AcaptureLead", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Capturar lead");
    expect(html).toContain("Apagar tool");
  });
});

describe("Mi Agente — tool toggle", () => {
  it("disables and re-enables a tool via settings.disabled_tools", async () => {
    // Toggle off
    let res = await adminApp.request(
      "/agente/tools/catalogQuery/toggle",
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBe("catalogQuery");
    expect(await res.text()).toContain("Encender tool");

    // Toggle back on
    res = await adminApp.request(
      "/agente/tools/catalogQuery/toggle",
      { method: "POST", headers: AUTH },
      env,
    );
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBe("");
    expect(await res.text()).toContain("Apagar tool");
  });

  it("rejects unknown tool names", async () => {
    const res = await adminApp.request(
      "/agente/tools/noExiste/toggle",
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(404);
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBeNull();
  });

  it("disabled tools render as OFF in the canvas", async () => {
    await settings.set(SETTING_KEYS.disabledTools, "scheduleAppointment");
    const res = await adminApp.request("/agente/canvas", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("apagada");
    expect(html).toContain("OFF");
  });
});

describe("Mi Agente — node save (modals)", () => {
  it("saves the buffer seconds with clamping", async () => {
    const res = await adminApp.request(
      "/agente/node/buffer/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ buffer_seconds: "12" }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("HX-Trigger")).toBe("canvas-refresh");
    expect(await settings.get(SETTING_KEYS.bufferSeconds)).toBe("12");
    expect(await res.text()).toContain("Guardado");

    // Out of range clamps to the max.
    await adminApp.request(
      "/agente/node/buffer/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ buffer_seconds: "999" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.bufferSeconds)).toBe("60");
  });

  it("saves reply chunks and converts the delay from seconds to ms", async () => {
    await adminApp.request(
      "/agente/node/reply/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ max_chunks: "4", inter_chunk_delay_s: "1.5" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.maxChunks)).toBe("4");
    expect(await settings.get(SETTING_KEYS.interChunkDelayMs)).toBe("1500");
  });

  it("saves model override and temperature", async () => {
    await adminApp.request(
      "/agente/node/model/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ model_override: "haiku", temperature: "0.3" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.modelOverride)).toBe("haiku");
    expect(await settings.get(SETTING_KEYS.temperature)).toBe("0.3");
  });

  it("rejects an invalid model override value", async () => {
    await adminApp.request(
      "/agente/node/model/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ model_override: "gpt-5" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.modelOverride)).toBeNull();
  });

  it("brain: saves a manual prompt, then resets back to automatic", async () => {
    await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ system_prompt_override: "MI PROMPT MANUAL" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBe("MI PROMPT MANUAL");

    // The modal now reflects manual mode.
    const modal = await adminApp.request("/agente/node/brain", { headers: AUTH }, env);
    expect(await modal.text()).toContain("manual");

    // Reset wins over the textarea content.
    await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "reset", system_prompt_override: "lo que sea" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBe("");
  });

  it("brain: toggles the global pause", async () => {
    await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ bot_paused: "1" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.botPaused)).toBe("1");
    const modal = await adminApp.request("/agente/node/brain", { headers: AUTH }, env);
    expect(await modal.text()).toContain("Reactivar el bot");
  });

  it("unknown node id returns 404", async () => {
    const res = await adminApp.request(
      "/agente/node/bogus/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ x: "1" }) },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("Mi Agente — channel selector above the canvas", () => {
  // A bot with two configured channels: WhatsApp (twilio) + Instagram.
  let chEnv: Env;
  beforeEach(() => {
    chEnv = { ...env, TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as Env;
  });

  it("renders the selector with General + one option per configured channel", async () => {
    const res = await adminApp.request("/agente", { headers: AUTH }, chEnv);
    const html = await res.text();
    expect(html).toContain('id="channel-select"');
    expect(html).toContain("Viendo el flujo de:");
    expect(html).toContain("General (todos los canales)");
    expect(html).toContain(">WhatsApp<");
    expect(html).toContain(">Instagram<");
    // Not configured → no option for it.
    expect(html).not.toContain(">Telegram<");
    // The canvas poll includes the selector so it stays on the chosen channel.
    expect(html).toContain('hx-include="#channel-select"');
  });

  it("no selector when the bot has no configured channels", async () => {
    const res = await adminApp.request("/agente", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).not.toContain('id="channel-select"');
  });

  it("the canvas fragment bakes ?channel into node links for the viewed channel", async () => {
    const res = await adminApp.request("/agente/canvas?channel=twilio", { headers: AUTH }, chEnv);
    const html = await res.text();
    // Node hx-gets carry the channel so clicking opens the modal for it.
    expect(html).toContain("/admin/agente/node/brain?channel=twilio");
    expect(html).toContain("node/tool%3AcatalogQuery?channel=twilio");
  });

  it("General canvas has no ?channel in node links", async () => {
    const res = await adminApp.request("/agente/canvas", { headers: AUTH }, chEnv);
    const html = await res.text();
    expect(html).toContain('/admin/agente/node/brain"');
    expect(html).not.toContain("node/brain?channel=");
  });

  it("a bogus ?channel falls back to General (never desyncs the view)", async () => {
    await settings.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "PROMPT WHATSAPP");
    const res = await adminApp.request("/agente/canvas?channel=noexiste", { headers: AUTH }, chEnv);
    const html = await res.text();
    expect(html).not.toContain("node/brain?channel=");
  });
});

describe("Mi Agente — canvas is channel-aware", () => {
  let chEnv: Env;
  beforeEach(() => {
    chEnv = { ...env, TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as Env;
  });

  it("the Agente node badge reflects the viewed channel's prompt state", async () => {
    await settings.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "PROMPT WHATSAPP");
    // WhatsApp has its own prompt → "personalidad propia".
    let html = await (await adminApp.request("/agente/canvas?channel=twilio", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("personalidad propia");
    // Instagram inherits → "usando la general".
    html = await (await adminApp.request("/agente/canvas?channel=instagram", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("usando la general");
    // General view keeps the classic wording.
    html = await (await adminApp.request("/agente/canvas", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("prompt automático");
  });

  it("channel view HIDES a tool off for that channel; the other channel still shows it", async () => {
    await settings.set(`${SETTING_KEYS.disabledTools}:instagram`, "catalogQuery");
    // Instagram: catalogQuery node is HIDDEN (clean toolbox — no OFF node).
    const ig = await (await adminApp.request("/agente/canvas?channel=instagram", { headers: AUTH }, chEnv)).text();
    expect(ig).not.toContain("node/tool%3AcatalogQuery?channel=instagram");
    // A tool still enabled for Instagram is present.
    expect(ig).toContain("node/tool%3AsearchKb?channel=instagram");
    // WhatsApp: catalogQuery still drawn.
    const tw = await (await adminApp.request("/agente/canvas?channel=twilio", { headers: AUTH }, chEnv)).text();
    expect(tw).toContain("node/tool%3AcatalogQuery?channel=twilio");
  });

  it("General view still draws disabled tools as OFF (not hidden)", async () => {
    await settings.set(SETTING_KEYS.disabledTools, "catalogQuery");
    const gen = await (await adminApp.request("/agente/canvas", { headers: AUTH }, chEnv)).text();
    expect(gen).toContain("node/tool%3AcatalogQuery"); // still on the canvas
    expect(gen).toContain("OFF");
    expect(gen).toContain("apagada");
  });
});

describe("Mi Agente — brain modal is single-channel (driven by the selector)", () => {
  let chEnv: Env;
  beforeEach(() => {
    chEnv = { ...env, TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as Env;
  });

  it("General view shows the classic global prompt editor (manual/auto + pause)", async () => {
    const html = await (await adminApp.request("/agente/node/brain", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("prompt efectivo");
    expect(html).toContain("Pausar el bot");
    // No per-channel copy button in General.
    expect(html).not.toContain("Copiar la general para editar");
  });

  it("channel view (no override) shows 'usando la general' + copy button, no pause", async () => {
    const html = await (await adminApp.request("/agente/node/brain?channel=instagram", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("usando la general");
    expect(html).toContain("Copiar la general para editar");
    expect(html).toContain("Agente en Instagram");
    // Pause is global-only.
    expect(html).not.toContain("Pausar el bot");
  });

  it("channel view (with override) shows 'personalidad propia' + delete button", async () => {
    await settings.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "PROMPT WHATSAPP");
    const html = await (await adminApp.request("/agente/node/brain?channel=twilio", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("personalidad propia");
    expect(html).toContain("Borrar lo personalizado");
  });

  it("the modal includes a per-channel tools list (so hidden tools can be re-enabled)", async () => {
    // catalogQuery is hidden from the Instagram canvas when off, but it MUST
    // still appear in the modal's list (with an 'Encender' toggle) so it can
    // come back.
    await settings.set(`${SETTING_KEYS.disabledTools}:instagram`, "catalogQuery");
    const html = await (await adminApp.request("/agente/node/brain?channel=instagram", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("Tools en Instagram");
    expect(html).toContain("Consultar catálogo"); // human label from toolMeta
    expect(html).toContain("/admin/agente/node/brain/tools/catalogQuery/toggle");
    // It's off for this channel → the list offers to turn it back on.
    expect(html).toContain("Encender");
  });

  it("General modal tools list is labeled for all channels", async () => {
    const html = await (await adminApp.request("/agente/node/brain", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("Tools (todos los canales)");
  });

  it("saving a channel prompt writes only that channel's key; global + others untouched", async () => {
    const res = await adminApp.request(
      "/agente/node/brain/save",
      {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ channel: "twilio", system_prompt_override: "PROMPT SOLO WHATSAPP" }),
      },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:twilio`)).toBe("PROMPT SOLO WHATSAPP");
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBeNull();
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:instagram`)).toBeNull();
    // Re-render stays on the WhatsApp view.
    const html = await res.text();
    expect(html).toContain("Agente en WhatsApp");
    expect(html).toContain("personalidad propia");
  });

  it("'copiar la general' forks the CURRENT effective global prompt into the channel", async () => {
    await settings.set(SETTING_KEYS.systemPromptOverride, "PROMPT GLOBAL VIGENTE");
    const res = await adminApp.request(
      "/agente/node/brain/save",
      {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ channel: "instagram", action: "copy-general" }),
      },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:instagram`)).toBe("PROMPT GLOBAL VIGENTE");
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBe("PROMPT GLOBAL VIGENTE");
  });

  it("'borrar lo personalizado' resets the channel back to inheriting", async () => {
    await settings.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "PROMPT PROPIO");
    const res = await adminApp.request(
      "/agente/node/brain/save",
      {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ channel: "twilio", action: "reset", system_prompt_override: "lo que sea" }),
      },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:twilio`)).toBe("");
    expect(await (await adminApp.request("/agente/node/brain?channel=twilio", { headers: AUTH }, chEnv)).text()).toContain("usando la general");
  });

  it("General save/reset/pause still touch only the global key", async () => {
    await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ system_prompt_override: "GLOBAL MANUAL" }) },
      chEnv,
    );
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBe("GLOBAL MANUAL");
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:twilio`)).toBeNull();
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:instagram`)).toBeNull();
  });

  // --- Rediseño: sección Instrucciones (aditiva) + secciones automáticas ---
  it("el modal muestra Instrucciones + preview por secciones (con el bloque resaltado) + modo experto", async () => {
    const html = await (await adminApp.request("/agente/node/brain", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("Instrucciones");
    expect(html).toContain('name="custom_instructions"'); // el textarea aditivo
    expect(html).toContain("por secciones"); // el preview siempre visible
    expect(html).toContain("automático"); // los bloques 🔒
    expect(html).toContain("AQUÍ ENTRAN TUS INSTRUCCIONES"); // el bloque resaltado (aunque vacío)
    expect(html).toContain("Modo experto");
  });

  it("guardar Instrucciones escribe custom_instructions (global) SIN tocar el override", async () => {
    const res = await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ custom_instructions: "No agendes domingos." }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.customInstructions)).toBe("No agendes domingos.");
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBeNull();
  });

  it("Instrucciones por canal escriben solo la key del canal", async () => {
    const res = await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "twilio", custom_instructions: "Regla WhatsApp" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.customInstructions}:twilio`)).toBe("Regla WhatsApp");
    expect(await settings.get(SETTING_KEYS.customInstructions)).toBeNull();
  });

  it("borrar Instrucciones (reset-custom) las vacía SIN tocar el override", async () => {
    await settings.set(SETTING_KEYS.customInstructions, "algo");
    await settings.set(SETTING_KEYS.systemPromptOverride, "MI OVERRIDE");
    const res = await adminApp.request(
      "/agente/node/brain/save",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "reset-custom" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.customInstructions)).toBe("");
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBe("MI OVERRIDE");
  });
});

describe("Mi Agente — tool node toggle is channel-scoped", () => {
  let chEnv: Env;
  beforeEach(() => {
    chEnv = { ...env, TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as Env;
  });

  it("toggling a tool with channel=instagram writes disabled_tools:instagram only", async () => {
    const res = await adminApp.request(
      "/agente/tools/catalogQuery/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "instagram" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.disabledTools}:instagram`)).toBe("catalogQuery");
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBeNull();
    expect(await settings.get(`${SETTING_KEYS.disabledTools}:twilio`)).toBeNull();
    // Re-render is the tool modal for that channel.
    expect(await res.text()).toContain("Encender tool en Instagram");
  });

  it("toggling with no channel writes the shared global key (classic behavior)", async () => {
    const res = await adminApp.request(
      "/agente/tools/catalogQuery/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBe("catalogQuery");
  });

  it("a tool off GLOBALLY is locked in a channel view (no per-channel toggle)", async () => {
    await settings.set(SETTING_KEYS.disabledTools, "catalogQuery");
    const html = await (await adminApp.request("/agente/node/tool%3AcatalogQuery?channel=instagram", { headers: AUTH }, chEnv)).text();
    expect(html).toContain("apagada en"); // "…está apagada en General…"
    expect(html).not.toContain("Encender tool en Instagram");
  });

  it("rejects unknown tool names", async () => {
    const res = await adminApp.request(
      "/agente/tools/noExiste/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "twilio" }) },
      chEnv,
    );
    expect(res.status).toBe(404);
  });
});

describe("Mi Agente — Agente-modal tools list toggle (re-enable hidden tools)", () => {
  let chEnv: Env;
  beforeEach(() => {
    chEnv = { ...env, TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as Env;
  });

  it("toggling from the list (channel) writes disabled_tools:<canal> and re-renders the Agente modal", async () => {
    const res = await adminApp.request(
      "/agente/node/brain/tools/catalogQuery/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "instagram" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.disabledTools}:instagram`)).toBe("catalogQuery");
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBeNull();
    expect(await settings.get(`${SETTING_KEYS.disabledTools}:twilio`)).toBeNull();
    // Re-render is the WHOLE Agente modal for that channel (not the tool modal).
    const html = await res.text();
    expect(html).toContain("Agente en Instagram");
    expect(html).toContain("Tools en Instagram");
  });

  it("re-enabling from the list removes it from disabled_tools:<canal>", async () => {
    await settings.set(`${SETTING_KEYS.disabledTools}:instagram`, "catalogQuery");
    const res = await adminApp.request(
      "/agente/node/brain/tools/catalogQuery/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "instagram" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(`${SETTING_KEYS.disabledTools}:instagram`)).toBe("");
    // Back on the Instagram canvas the node reappears.
    const canvas = await (await adminApp.request("/agente/canvas?channel=instagram", { headers: AUTH }, chEnv)).text();
    expect(canvas).toContain("node/tool%3AcatalogQuery?channel=instagram");
  });

  it("toggling from the list with no channel writes the global key", async () => {
    const res = await adminApp.request(
      "/agente/node/brain/tools/catalogQuery/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "" }) },
      chEnv,
    );
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.disabledTools)).toBe("catalogQuery");
  });

  it("rejects unknown tool names on the list toggle route", async () => {
    const res = await adminApp.request(
      "/agente/node/brain/tools/noExiste/toggle",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: "twilio" }) },
      chEnv,
    );
    expect(res.status).toBe(404);
  });
});

describe("Mi Agente — per-channel safety net", () => {
  let chEnv: Env;
  beforeEach(() => {
    chEnv = { ...env, TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as Env;
  });

  it("GET-only navigation never mutates any prompt/tool setting", async () => {
    await settings.set(SETTING_KEYS.systemPromptOverride, "PROMPT ORIGINAL INTOCABLE");
    await settings.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "PROMPT WHATSAPP INTOCABLE");
    await settings.set(`${SETTING_KEYS.disabledTools}:instagram`, "catalogQuery");
    await adminApp.request("/agente", { headers: AUTH }, chEnv);
    await adminApp.request("/agente/canvas?channel=twilio", { headers: AUTH }, chEnv);
    await adminApp.request("/agente/canvas?channel=instagram", { headers: AUTH }, chEnv);
    await adminApp.request("/agente/node/brain?channel=twilio", { headers: AUTH }, chEnv);
    await adminApp.request("/agente/node/tool%3AcatalogQuery?channel=instagram", { headers: AUTH }, chEnv);
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBe("PROMPT ORIGINAL INTOCABLE");
    expect(await settings.get(`${SETTING_KEYS.systemPromptOverride}:twilio`)).toBe("PROMPT WHATSAPP INTOCABLE");
    expect(await settings.get(`${SETTING_KEYS.disabledTools}:instagram`)).toBe("catalogQuery");
  });
});
