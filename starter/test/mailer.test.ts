import { describe, it, expect, vi, afterEach } from "vitest";
import { sendMail, mailerProvider, plantillaCorreo } from "../src/mailer";
import type { Env } from "../src/env";

afterEach(() => vi.unstubAllGlobals());

describe("mailer — cadena Cloudflare Email → Resend → sin proveedor", () => {
  it("con binding EMAIL + EMAIL_FROM usa Cloudflare y no toca la red", async () => {
    const send = vi.fn(async () => ({ messageId: "cf-1" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = { EMAIL: { send }, EMAIL_FROM: "bot@negocio.com", BUSINESS_NAME: "Tacos Ana" } as unknown as Env;
    expect(mailerProvider(env)).toBe("cloudflare");
    const r = await sendMail(env, { to: "x@y.com", subject: "Hola", html: "<p>hola</p>" });
    expect(r).toEqual({ ok: true, provider: "cloudflare", id: "cf-1" });
    expect((send.mock.calls[0] as any)[0].from).toBe("Tacos Ana <bot@negocio.com>");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si Cloudflare falla y hay Resend, cae a Resend", async () => {
    const send = vi.fn(async () => { throw new Error("domain not onboarded"); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re-9" }), { status: 200 })));
    const env = { EMAIL: { send }, EMAIL_FROM: "bot@negocio.com", RESEND_API_KEY: "re_x", BUSINESS_NAME: "T" } as unknown as Env;
    const r = await sendMail(env, { to: "x@y.com", subject: "s", html: "<b>h</b>" });
    expect(r).toEqual({ ok: true, provider: "resend", id: "re-9" });
  });

  it("solo Resend (sin dominio propio) → remitente sandbox de Resend", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "re-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { RESEND_API_KEY: "re_x", BUSINESS_NAME: "T" } as unknown as Env;
    expect(mailerProvider(env)).toBe("resend");
    await sendMail(env, { to: "x@y.com", subject: "s", html: "h" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body));
    expect(body.from).toBe("T <onboarding@resend.dev>");
  });

  it("sin nada → sin_proveedor (el caller degrada, no truena)", async () => {
    const env = { BUSINESS_NAME: "T" } as unknown as Env;
    expect(mailerProvider(env)).toBe(null);
    expect(await sendMail(env, { to: "x@y.com", subject: "s", html: "h" })).toEqual({ ok: false, reason: "sin_proveedor" });
  });

  it("plantillaCorreo escapa HTML en título/CTA y muestra la URL en texto", () => {
    const html = plantillaCorreo({ BUSINESS_NAME: "A<b>" } as any, { titulo: "Hola <x>", cuerpo: "c", cta: { url: "https://p/1?a=1&b=2", label: "Ir" } });
    expect(html).toContain("A&lt;b&gt;");
    expect(html).toContain("Hola &lt;x&gt;");
    expect(html).toContain("https://p/1?a=1&amp;b=2");
  });
});
