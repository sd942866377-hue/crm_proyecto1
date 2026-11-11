/**
 * Pre-deploy config check (LOCAL — no network, no Skool/tier API).
 *
 * The Free vs Pro distinction lives in separate repos, so there is nothing to
 * validate against a remote service: we just make sure the secrets and vars
 * this bot needs are present before `wrangler deploy` runs. Run via
 * `pnpm exec tsx scripts/deploy-check.ts` (or wire it as a predeploy step).
 */

export interface DeployConfig {
  ANTHROPIC_API_KEY?: string;
  BOT_NAME?: string;
  BOT_TIER?: string;
  DASHBOARD_PASSWORD?: string;
  // at least one customer channel:
  TELEGRAM_BOT_TOKEN?: string;
  MANYCHAT_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  [k: string]: string | undefined;
}

export interface DeployCheckResult {
  ok: boolean;
  errors: string[];
}

/**
 * Cómo se invoca npx según el sistema. En Windows es `npx.cmd`, y
 * `execFileSync` NO puede ejecutar un `.cmd`: tira ENOENT. Pasaba
 * desapercibido porque el error se atrapaba y se seguía como si no hubiera
 * secrets — bloqueando el deploy de todos los miembros en Windows.
 */
export function binarioNpx(platform: string): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

/**
 * Qué hacer cuando un secret requerido no aparece.
 *
 * La regla es una: **no bloquees por lo que no pudiste verificar.** Si no
 * logramos leer los secrets de Cloudflare (sin red, sin login, wrangler que no
 * arranca), no sabemos si el secret existe — y "no sé" nunca puede costarle al
 * miembro su deploy.
 */
export function faltaSecret(
  nombre: string,
  secretsLeidos: boolean,
): { nivel: "error" | "aviso"; mensaje: string } {
  if (secretsLeidos) {
    return {
      nivel: "error",
      mensaje: `Falta el secret ${nombre} (créalo: pnpm exec wrangler secret put ${nombre}).`,
    };
  }
  return {
    nivel: "aviso",
    mensaje:
      `No pude leer tus secrets de Cloudflare (¿sin conexión o sin \`wrangler login\`?), así que no sé si ya tienes ${nombre}. ` +
      `Si el panel te pide contraseña y no la tienes, créala con: pnpm exec wrangler secret put ${nombre}`,
  };
}

/** Pure validator — easy to unit test, no process/network access. */
export function validateDeployConfig(cfg: DeployConfig): DeployCheckResult {
  const errors: string[] = [];

  if (!cfg.ANTHROPIC_API_KEY) errors.push("Falta ANTHROPIC_API_KEY (Claude API).");
  if (!cfg.BOT_NAME) errors.push("Falta BOT_NAME.");
  if (!cfg.BOT_TIER) errors.push("Falta BOT_TIER ('free' | 'pro').");

  const hasChannel = Boolean(
    cfg.TELEGRAM_BOT_TOKEN || cfg.MANYCHAT_API_KEY || cfg.TWILIO_ACCOUNT_SID,
  );
  if (!hasChannel) {
    errors.push(
      "No hay ningún canal configurado: define al menos TELEGRAM_BOT_TOKEN, MANYCHAT_API_KEY o TWILIO_ACCOUNT_SID.",
    );
  }

  if (cfg.BOT_TIER === "pro" && !cfg.DASHBOARD_PASSWORD) {
    errors.push("BOT_TIER=pro requiere DASHBOARD_PASSWORD (Basic Auth del dashboard).");
  }

  return { ok: errors.length === 0, errors };
}

// Contenido mínimo de member/tools.local.ts (el punto de extensión de tools del
// miembro). El core lo IMPORTA, así que DEBE existir o `wrangler deploy` truena.
export const MEMBER_TOOLS_STUB = `// member/tools.local.ts — TUS funciones extra ("tools") del bot.
// Esta carpeta (member/) es TUYA: \`forjabot update\` NUNCA la pisa; lo que
// definas aquí sobrevive cada actualización. Usa el skill /agregar-tool para
// escribir una sin programar.
import type { MemberToolCtx } from "../src/tools/member";

export function memberTools(ctx: MemberToolCtx): Record<string, unknown> {
  void ctx;
  return {};
}
`;

/**
 * Candado de build: crea member/tools.local.ts si falta. Es el respaldo final
 * (el update ya intenta crearlo) para que NUNCA se rompa el deploy por un
 * miembro que actualizó con un CLI viejo o una caché de npx. Additivo: si el
 * archivo ya existe (el del miembro), NO lo toca. Devuelve true si lo creó.
 */
export function ensureMemberToolsFile(
  fs: { existsSync(p: string): boolean; writeFileSync(p: string, c: string): void },
  path = "member/tools.local.ts",
): boolean {
  if (fs.existsSync(path)) return false;
  fs.writeFileSync(path, MEMBER_TOOLS_STUB);
  return true;
}

// Run as a script: read from process.env and exit non-zero on failure.
// Guarded so importing this module in tests does not call process.exit.
declare const process: { env: Record<string, string | undefined>; exit(code: number): never };
const isMain =
  typeof process !== "undefined" &&
  typeof (process as any).argv !== "undefined" &&
  /deploy-check\.ts$/.test(String((process as any).argv?.[1] ?? ""));

if (isMain) {
  // El check corre en la MÁQUINA DEL MIEMBRO, donde process.env está vacío: la
  // verdad vive en wrangler.toml ([vars] estampadas por el CLI) y en los SECRETS
  // remotos de Cloudflare. Además, el flujo documentado conecta canales DESPUÉS
  // del primer deploy (FASE 3) y la llave de IA puede ponerse desde el panel —
  // así que canal/llave son AVISOS, no errores que bloqueen.
  const cfg: DeployConfig = { ...process.env };

  // Candado de build (antes de cualquier otra cosa): garantiza que exista el
  // archivo de funciones extra del miembro. Sin él, el build truena.
  try {
    const { existsSync, writeFileSync } = await import("node:fs");
    if (ensureMemberToolsFile({ existsSync, writeFileSync })) {
      console.warn("ℹ️  Creé member/tools.local.ts (tu archivo de funciones extra). Agrega capacidades con /agregar-tool.");
    }
  } catch { /* si no se puede escribir, el error real saldrá en el build */ }

  let tieneBindingAi = true; // si no podemos leer el toml, no acusamos
  try {
    const { readFileSync } = await import("node:fs");
    const toml = readFileSync("wrangler.toml", "utf8");
    for (const k of ["BOT_NAME", "BOT_TIER", "ANTHROPIC_BASE_URL"] as const) {
      if (!cfg[k]) cfg[k] = toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m"))?.[1];
    }
    // Sin el binding [ai] no hay Workers AI: ni transcripción de notas de voz
    // ni el fallback de visión (bots viejos: update preserva su toml).
    tieneBindingAi = /^\s*\[ai\]/m.test(toml) && /binding\s*=\s*"AI"/.test(toml);
  } catch { /* sin wrangler.toml: lo reportará el error de BOT_TIER */ }

  // ¿Pudimos leer los secrets remotos? Si NO, no sabemos nada de ellos — y eso
  // es distinto de saber que faltan. Sin esta distinción, cualquier fallo al
  // listar se convertía en "falta DASHBOARD_PASSWORD" y bloqueaba el deploy.
  let secretsLeidos = false;
  try {
    const { execFileSync } = await import("node:child_process");
    // En Windows `npx` es `npx.cmd` y execFileSync NO puede ejecutar archivos
    // .cmd: tiraba ENOENT, el catch se lo tragaba, y el miembro no podía
    // desplegar. (Reportado desde Windows 11 + PowerShell, 28-jul-2026.)
    const npx = binarioNpx(String((process as any).platform ?? ""));
    const raw = execFileSync(npx, ["wrangler", "secret", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const s of JSON.parse(raw.slice(raw.indexOf("["))) as { name: string }[]) {
      if (!cfg[s.name]) cfg[s.name] = "(remote)";
    }
    secretsLeidos = true;
  } catch { /* sin red, sin login, o wrangler no disponible: no sabemos */ }

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!cfg.BOT_NAME) errors.push("Falta BOT_NAME en wrangler.toml.");
  if (!cfg.BOT_TIER) errors.push("Falta BOT_TIER ('free' | 'pro') en wrangler.toml.");
  if (!cfg.DASHBOARD_PASSWORD) {
    const v = faltaSecret("DASHBOARD_PASSWORD", secretsLeidos);
    (v.nivel === "error" ? errors : warnings).push(v.mensaje);
  }
  if (!cfg.ANTHROPIC_API_KEY && !cfg.OPENAI_API_KEY && !cfg.XAI_API_KEY) {
    warnings.push("Aún no hay llave de IA como secret — el bot desplegará pero no contestará. Ponla con `wrangler secret put ANTHROPIC_API_KEY` (o desde el panel: Configuración → Modelo de IA).");
  }
  if (!cfg.TELEGRAM_BOT_TOKEN && !cfg.MANYCHAT_API_KEY && !cfg.TWILIO_ACCOUNT_SID && !cfg.META_PAGE_ACCESS_TOKEN) {
    warnings.push("Aún no hay canales conectados — normal antes de la FASE 3 (se conectan con el panel abierto en /admin/conexiones).");
  }
  // Telegram sin secret_token = webhook abierto: cualquiera con la URL puede
  // inyectar mensajes. Aviso (no error) para no bloquear bots registrados antes.
  if (!tieneBindingAi) {
    warnings.push(
      "Tu wrangler.toml no tiene el binding [ai] (Workers AI): las notas de voz de tus clientes no se transcriben y no hay respaldo de visión. " +
      "Agrega estas dos líneas y redeploy:\n     [ai]\n     binding = \"AI\"",
    );
  }
  if (cfg.TELEGRAM_BOT_TOKEN && !cfg.TELEGRAM_WEBHOOK_SECRET) {
    warnings.push(
      "Tu webhook de Telegram no tiene secreto: cualquiera con la URL del worker puede escribirle a tu bot. " +
      "Protégelo así: genera un valor aleatorio, guárdalo con `wrangler secret put TELEGRAM_WEBHOOK_SECRET`, " +
      "y vuelve a registrar el webhook agregando `&secret_token=<ese valor>` al setWebhook (la guía de Telegram trae el comando).",
    );
  }

  // Auditor de gasto de IA (y protección del 403 del edge): si el bot usa
  // Anthropic, conviene rutearlo por el AI Gateway de Cloudflare. Es el que
  // cuadra la libreta de gastos (ia_usage) contra la factura real y evita el 403
  // heredado del webhook. La libreta funciona igual sin esto — el gateway es el
  // AUDITOR, no un requisito. Aviso, nunca bloqueo.
  const baseUrl = (cfg.ANTHROPIC_BASE_URL ?? "").trim();
  const usaAnthropic = Boolean(cfg.ANTHROPIC_API_KEY) || baseUrl !== "";
  if (baseUrl && !/gateway\.ai\.cloudflare\.com/.test(baseUrl)) {
    warnings.push(
      "Tu ANTHROPIC_BASE_URL no apunta al AI Gateway de Cloudflare: el auditor de gasto de IA no podrá cuadrar la libreta contra la factura real (y pierdes la protección del 403 del edge). Si es a propósito, ignóralo.",
    );
  } else if (usaAnthropic && !baseUrl) {
    warnings.push(
      "Para auditar tu gasto de IA contra la factura real (y evitar el 403 del edge de Anthropic), rutea Anthropic por el AI Gateway de Cloudflare: en wrangler.toml pon " +
        'ANTHROPIC_BASE_URL = "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic". ' +
        "La libreta de gastos ya funciona sin esto; el gateway es el auditor.",
    );
  }

  if (warnings.length) console.warn("⚠️  Avisos:\n - " + warnings.join("\n - "));
  if (errors.length) {
    console.error("❌ Config incompleta para deploy:\n - " + errors.join("\n - "));
    process.exit(1);
  }
  console.log("✅ Config de deploy OK." + (warnings.length ? " (con avisos)" : ""));
}
