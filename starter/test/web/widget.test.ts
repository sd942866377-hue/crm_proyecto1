import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo } from "../../src/db/settings";
import {
  MAX_TURNS_DIA,
  MAX_TURNS_IP_DIA,
  MAX_TURNS_SESION,
  claveDeIp,
  hashIp,
  limites,
  nuevaSesion,
  origenPermitido,
  sitiosPermitidos,
  webChannelEnabled,
} from "../../src/web/widget";
import type { Env } from "../../src/env";

const env = (WEB_SITES?: string) => ({ WEB_SITES }) as Env;
const pet = (origin?: string, referer?: string) =>
  new Request("https://bot.workers.dev/web/send", {
    method: "POST",
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(referer ? { Referer: referer } : {}),
    },
  });

describe("canal web — encendido", () => {
  it("apagado si no hay dominios configurados", () => {
    expect(webChannelEnabled(env())).toBe(false);
    expect(webChannelEnabled(env("   "))).toBe(false);
  });

  it("encendido en cuanto hay uno", () => {
    expect(webChannelEnabled(env("minegocio.com"))).toBe(true);
  });

  it("normaliza lo que el dueño escriba", () => {
    // La gente pega la URL completa, con barra y en mayúsculas.
    expect(sitiosPermitidos(env("https://MiNegocio.com/, www.otro.mx "))).toEqual([
      "minegocio.com",
      "www.otro.mx",
    ]);
  });
});

describe("canal web — de dónde acepta peticiones", () => {
  const e = env("minegocio.com");

  it("acepta el dominio configurado", () => {
    expect(origenPermitido(e, pet("https://minegocio.com"))).toBe(true);
  });

  it("acepta sus subdominios (www, tienda…)", () => {
    expect(origenPermitido(e, pet("https://www.minegocio.com"))).toBe(true);
    expect(origenPermitido(e, pet("https://tienda.minegocio.com"))).toBe(true);
  });

  it("rechaza otro sitio que copie el script", () => {
    expect(origenPermitido(e, pet("https://sitio-ajeno.com"))).toBe(false);
  });

  it("rechaza un dominio que solo TERMINA parecido", () => {
    // "notminegocio.com" no es subdominio de "minegocio.com".
    expect(origenPermitido(e, pet("https://notminegocio.com"))).toBe(false);
  });

  it("rechaza peticiones sin origen (curl, scripts)", () => {
    expect(origenPermitido(e, pet())).toBe(false);
  });

  it("usa el Referer cuando no hay Origin", () => {
    expect(origenPermitido(e, pet(undefined, "https://minegocio.com/precios"))).toBe(true);
  });

  it("sin dominios configurados no acepta a nadie", () => {
    expect(origenPermitido(env(), pet("https://minegocio.com"))).toBe(false);
  });

  it('"*" abre a cualquiera, pero solo si se pone a propósito', () => {
    expect(origenPermitido(env("*"), pet("https://cualquiera.com"))).toBe(true);
  });
});

describe("canal web — topes contra el spam", () => {
  let envDb: any;
  let repo: SettingsRepo;

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    envDb = { DB: d1, WEB_SITES: "minegocio.com" };
    repo = new SettingsRepo(new Db(d1 as any));
  });

  it("sin configurar nada, trae los tres topes por defecto", async () => {
    expect(await limites(envDb)).toEqual({
      sesion: MAX_TURNS_SESION,
      ipDia: MAX_TURNS_IP_DIA,
      dia: MAX_TURNS_DIA,
    });
  });

  it("el miembro puede subirlos desde el panel", async () => {
    await repo.set("web_limite_dia", "5000");
    await repo.set("web_limite_ip_dia", "200");
    const t = await limites(envDb);
    expect(t.dia).toBe(5000);
    expect(t.ipDia).toBe(200);
    expect(t.sesion).toBe(MAX_TURNS_SESION); // el que no tocó no cambia
  });

  it("un valor basura no apaga el freno ni lo deja en 1", async () => {
    // Dos formas de romperlo: quedarse SIN tope (le vacían la cuenta de IA) o
    // quedarse con tope 1 (su chat muere al primer mensaje). "1e5" cae en la
    // segunda con parseInt, por eso el valor tiene que ser dígitos y ya.
    for (const malo of ["muchos", "", "-1", "0", "abc", "1e9999", "1e5", "500px", "5.5"]) {
      await repo.set("web_limite_dia", malo);
      expect((await limites(envDb)).dia, malo).toBe(MAX_TURNS_DIA);
    }
  });

  it("acepta un tope bajo a propósito (bot personal, presupuesto corto)", async () => {
    await repo.set("web_limite_dia", "20");
    expect((await limites(envDb)).dia).toBe(20);
  });
});

describe("canal web — a quién cuenta como un mismo visitante", () => {
  it("dos IPv4 distintas son visitantes distintos", () => {
    expect(claveDeIp("189.203.1.5")).not.toBe(claveDeIp("189.203.1.6"));
  });

  it("una IPv6 del mismo hogar cuenta como el MISMO visitante", () => {
    // A un cliente doméstico le dan un /64 entero: puede estrenar dirección en
    // cada petición. Si contáramos la dirección completa, el tope diario por
    // visitante no frenaría nada.
    const a = claveDeIp("2806:2f0:5061:abcd:1111:2222:3333:4444");
    const b = claveDeIp("2806:2f0:5061:abcd:9999:8888:7777:6666");
    expect(a).toBe(b);
    expect(hashIp("2806:2f0:5061:abcd::1")).toBe(hashIp("2806:2f0:5061:abcd::dead:beef"));
  });

  it("dos hogares IPv6 distintos siguen siendo visitantes distintos", () => {
    expect(claveDeIp("2806:2f0:5061:abcd::1")).not.toBe(claveDeIp("2806:2f0:5061:ffff::1"));
  });

  it("entiende la notación corta :: donde sea que esté", () => {
    expect(claveDeIp("2001:db8::1")).toBe("2001:0db8:0000:0000");
    expect(claveDeIp("::1")).toBe("0000:0000:0000:0000");
    expect(claveDeIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:0db8:0000:0000");
  });

  it("no confunde mayúsculas ni ceros a la izquierda", () => {
    expect(claveDeIp("2806:02F0::1")).toBe(claveDeIp("2806:2f0:0:0::1"));
  });
});

describe("canal web — identidad del visitante", () => {
  it("la misma IP siempre cae en el mismo grupo", () => {
    expect(hashIp("189.203.1.5")).toBe(hashIp("189.203.1.5"));
  });

  it("IPs distintas caen en grupos distintos", () => {
    expect(hashIp("189.203.1.5")).not.toBe(hashIp("189.203.1.6"));
  });

  it("cada sesión es única pero conserva el grupo de su IP", () => {
    const a = nuevaSesion("189.203.1.5");
    const b = nuevaSesion("189.203.1.5");
    expect(a).not.toBe(b); // no se repite
    expect(a.split("-")[0]).toBe(b.split("-")[0]); // mismo prefijo → mismo tope diario
    expect(a.split("-")[0]).toBe(hashIp("189.203.1.5"));
  });

  it("el prefijo delata una sesión de otra IP (id inventado)", () => {
    const ajena = nuevaSesion("8.8.8.8");
    expect(ajena.startsWith(`${hashIp("189.203.1.5")}-`)).toBe(false);
  });
});
