import { describe, it, expect } from "vitest";
import { binarioNpx, faltaSecret, validateDeployConfig, ensureMemberToolsFile, MEMBER_TOOLS_STUB } from "../scripts/deploy-check";

describe("cómo se llama a npx según el sistema", () => {
  // Reportado desde Windows 11 + PowerShell el 28-jul-2026: el deploy se
  // bloqueaba diciendo que faltaba un secret que SÍ existía. La causa era esto.
  it("en Windows usa npx.cmd — execFileSync no puede correr un .cmd sin el sufijo", () => {
    expect(binarioNpx("win32")).toBe("npx.cmd");
  });

  it("en Mac y Linux usa npx a secas", () => {
    expect(binarioNpx("darwin")).toBe("npx");
    expect(binarioNpx("linux")).toBe("npx");
  });

  it("un sistema desconocido no rompe: cae en npx", () => {
    expect(binarioNpx("")).toBe("npx");
    expect(binarioNpx("freebsd")).toBe("npx");
  });
});

describe("un secret que no aparece", () => {
  it("SÍ bloquea si pudimos preguntarle a Cloudflare y no está", () => {
    const v = faltaSecret("DASHBOARD_PASSWORD", true);
    expect(v.nivel).toBe("error");
    expect(v.mensaje).toContain("wrangler secret put DASHBOARD_PASSWORD");
  });

  it("NO bloquea si no pudimos leer los secrets — no saber no es faltar", () => {
    // Este es el corazón del bug: cualquier fallo al listar (sin red, sin
    // login, npx que no arranca) se convertía en "falta" y tumbaba el deploy.
    const v = faltaSecret("DASHBOARD_PASSWORD", false);
    expect(v.nivel).toBe("aviso");
  });

  it("cuando no sabe, lo dice y no acusa al miembro", () => {
    const v = faltaSecret("DASHBOARD_PASSWORD", false);
    expect(v.mensaje).toMatch(/no sé si ya tienes/i);
    expect(v.mensaje).not.toMatch(/^Falta/);
  });

  it("el mensaje siempre nombra el secret y cómo crearlo", () => {
    for (const leidos of [true, false]) {
      const v = faltaSecret("KB_REINDEX_TOKEN", leidos);
      expect(v.mensaje, String(leidos)).toContain("KB_REINDEX_TOKEN");
      expect(v.mensaje, String(leidos)).toContain("wrangler secret put");
    }
  });
});

describe("ensureMemberToolsFile — candado de build (create-if-missing, additivo)", () => {
  it("crea member/tools.local.ts SOLO si falta, y nunca pisa el existente", () => {
    // No existe → lo crea con el stub.
    let written: { p: string; c: string } | null = null;
    const created = ensureMemberToolsFile({
      existsSync: () => false,
      writeFileSync: (p, c) => { written = { p, c }; },
    });
    expect(created).toBe(true);
    expect(written!.p).toBe("member/tools.local.ts");
    expect(written!.c).toBe(MEMBER_TOOLS_STUB);
    expect(MEMBER_TOOLS_STUB).toContain("export function memberTools");

    // Ya existe (el del miembro) → NO escribe nada. No borra, no pisa.
    let touched = false;
    const created2 = ensureMemberToolsFile({
      existsSync: () => true,
      writeFileSync: () => { touched = true; },
    });
    expect(created2).toBe(false);
    expect(touched).toBe(false);
  });
});

describe("validateDeployConfig", () => {
  const completo = {
    ANTHROPIC_API_KEY: "sk-x",
    BOT_NAME: "Barbería Pérez",
    BOT_TIER: "free",
    TELEGRAM_BOT_TOKEN: "123:abc",
  };

  it("una config completa pasa", () => {
    expect(validateDeployConfig(completo)).toEqual({ ok: true, errors: [] });
  });

  it("pro sin contraseña del panel no pasa", () => {
    const r = validateDeployConfig({ ...completo, BOT_TIER: "pro" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("DASHBOARD_PASSWORD");
  });

  it("sin ningún canal no pasa", () => {
    const { TELEGRAM_BOT_TOKEN, ...sinCanal } = completo;
    expect(validateDeployConfig(sinCanal).ok).toBe(false);
  });
});
