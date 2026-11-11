import { describe, it, expect } from "vitest";
import { extraeMediaIds, sendChunkedReply } from "../src/replies/sender";
import { renderSystemPrompt } from "../src/system-prompt";
import {
  listMediaAssets,
  putMediaAsset,
  deleteMediaAsset,
  getMediaBlob,
  kindForMime,
  kindFromId,
  isMediaId,
  MEDIA_META_PREFIX,
  MEDIA_BLOB_PREFIX,
} from "../src/media-assets";
import { Db } from "../src/db/client";
import type { Env } from "../src/env";
import type { OutgoingReply, ChannelAdapter } from "../src/channels/shared";

// ── Fake D1 en memoria (suficiente para settings get/set/all/delete) ─────────
function fakeD1(): { d1: D1Database; store: Map<string, string> } {
  const store = new Map<string, string>();
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (/^INSERT INTO settings/i.test(sql)) {
                store.set(String(params[0]), String(params[1]));
              } else if (/^DELETE FROM settings WHERE key IN/i.test(sql)) {
                for (const p of params) store.delete(String(p));
              }
              return { success: true } as unknown as D1Result;
            },
            async first() {
              if (/SELECT value FROM settings WHERE key = \?/i.test(sql)) {
                const v = store.get(String(params[0]));
                return v === undefined ? null : { value: v };
              }
              return null;
            },
            async all() {
              const results = [...store.entries()]
                .filter(([k]) => !/NOT LIKE 'media_blob:%'/.test(sql) || !k.startsWith("media_blob:"))
                .map(([key, value]) => ({ key, value }));
              return { results } as unknown as D1Result;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { d1, store };
}

const PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("extraeMediaIds (marcador → ids)", () => {
  it("extrae el id y limpia el marcador", () => {
    const r = extraeMediaIds(["Claro, aquí está el menú:\n[[media: img_abc12345]]"]);
    expect(r.chunks).toEqual(["Claro, aquí está el menú:"]);
    expect(r.medias).toEqual([{ id: "img_abc12345" }]);
  });

  it("dedupea y tope de 3 por respuesta", () => {
    const r = extraeMediaIds([
      "[[media: img_abc12345]] [[media: img_abc12345]] [[media: aud_def67890]] [[media: img_zzz99999]] [[media: img_www88888]]",
    ]);
    expect(r.medias.map((m) => m.id)).toEqual(["img_abc12345", "aud_def67890", "img_zzz99999"]);
  });

  it("ids con formato inválido NO se extraen pero el texto queda limpio de marcadores válidos", () => {
    const r = extraeMediaIds(["hola [[media: hack../../etc]] [[media: img_abc12345]]"]);
    expect(r.medias).toEqual([{ id: "img_abc12345" }]);
    expect(r.chunks[0]).toContain("[[media: hack../../etc]]"); // no matchea el patrón: se queda (jamás pasa isMediaId)
  });

  it("sin marcador no toca nada", () => {
    const r = extraeMediaIds(["hola", "¿en qué te ayudo?"]);
    expect(r.chunks).toEqual(["hola", "¿en qué te ayudo?"]);
    expect(r.medias).toEqual([]);
  });

  it("chunk que era SOLO marcador desaparece", () => {
    const r = extraeMediaIds(["Te mando la foto 📷", "[[media: img_abc12345]]"]);
    expect(r.chunks).toEqual(["Te mando la foto 📷"]);
    expect(r.medias).toEqual([{ id: "img_abc12345" }]);
  });
});

describe("media-assets (settings como storage)", () => {
  it("put → list → blob → delete round-trip", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const alta = await putMediaAsset(db, {
      nombre: "menú",
      desc: "el menú completo",
      mime: "image/png",
      dataBase64: PIXEL_B64,
    });
    expect(alta.ok).toBe(true);
    const id = (alta as { ok: true; id: string }).id;
    expect(id.startsWith("img_")).toBe(true);
    expect(isMediaId(id)).toBe(true);

    // list desde un snapshot de settings (como llega de SettingsRepo.all())
    const settings: Record<string, string> = {};
    const repoAll = await db.all<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key NOT LIKE 'media_blob:%'",
    );
    for (const r of repoAll) settings[r.key] = r.value;
    const metas = listMediaAssets(settings);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ id, kind: "image", nombre: "menú", mime: "image/png" });
    // El blob NO viaja en all() (excluido por la query)
    expect(Object.keys(settings).some((k) => k.startsWith(MEDIA_BLOB_PREFIX))).toBe(false);

    const blob = await getMediaBlob(db, id);
    expect(blob?.mime).toBe("image/png");
    expect(blob!.bytes.length).toBeGreaterThan(20);

    await deleteMediaAsset(db, id);
    expect(await getMediaBlob(db, id)).toBeNull();
  });

  it("rechaza mime raro y tamaño excedido", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const r1 = await putMediaAsset(db, { nombre: "x", desc: "", mime: "application/zip", dataBase64: PIXEL_B64 });
    expect(r1.ok).toBe(false);
    // video/mp4 es VÁLIDO desde 1.0.66 (video en la Galería)
    const rv = await putMediaAsset(db, { nombre: "clip", desc: "", mime: "video/mp4", dataBase64: PIXEL_B64 });
    expect(rv.ok).toBe(true);
    if (rv.ok) expect(rv.id.startsWith("vid_")).toBe(true);
    const r2 = await putMediaAsset(db, { nombre: "x", desc: "", mime: "image/png", dataBase64: "a".repeat(1_700_000) });
    expect(r2.ok).toBe(false);
  });

  it("kind helpers", () => {
    expect(kindForMime("image/jpeg")).toBe("image");
    expect(kindForMime("audio/ogg; codecs=opus")).toBe("audio");
    expect(kindForMime("application/pdf")).toBeNull();
    expect(kindFromId("img_abc12345")).toBe("image");
    expect(kindFromId("aud_abc12345")).toBe("audio");
    expect(kindFromId("vid_abc12345")).toBe("video");
    expect(kindForMime("video/mp4")).toBe("video");
    expect(kindFromId("doc_abc12345")).toBeNull();
  });
});

describe("bloque <galeria> del prompt", () => {
  const base = {
    botName: "Bot",
    businessName: "Negocio",
    language: "español",
    businessContext: "ctx",
    toolList: ["searchKb"],
  };

  it("sin assets (default): el prompt NO menciona la galería — byte-idéntico a hoy", () => {
    const p = renderSystemPrompt(base);
    expect(p).not.toContain("<galeria>");
    expect(p).not.toContain("[[media:");
  });

  it("con assets: lista ids con nombre y descripción", () => {
    const p = renderSystemPrompt({
      ...base,
      galeriaAssets: [
        { id: "img_abc12345", kind: "image", nombre: "menú", desc: "el menú completo", mime: "image/png", size: 10, createdAt: 1 },
        { id: "aud_def67890", kind: "audio", nombre: "precios", desc: "nota del dueño con planes", mime: "audio/ogg", size: 10, createdAt: 2 },
      ],
    });
    expect(p).toContain("<galeria>");
    expect(p).toContain("[[media: img_abc12345]] · FOTO · menú — el menú completo");
    expect(p).toContain("[[media: aud_def67890]] · AUDIO · precios — nota del dueño con planes");
  });
});

describe("sendChunkedReply con media", () => {
  function makeEnv(store: Map<string, string>, extra: Partial<Env> = {}): Env {
    const { d1 } = (() => {
      // reusa el store dado para que el asset "exista"
      const wrapper = fakeD1();
      for (const [k, v] of store) wrapper.store.set(k, v);
      return wrapper;
    })();
    return { DB: d1, DASHBOARD_BASE_URL: "https://bot.example.com", ...extra } as unknown as Env;
  }

  function makeAdapter(sent: OutgoingReply[]): ChannelAdapter {
    return {
      parseIncoming: async () => { throw new Error("no-op"); },
      sendReply: async (r) => { sent.push(r); },
    };
  }

  const store = new Map<string, string>([
    [MEDIA_META_PREFIX + "img_abc12345", JSON.stringify({ n: "menú", d: "", mime: "image/png", size: 10, at: 1 })],
    [MEDIA_BLOB_PREFIX + "img_abc12345", `data:image/png;base64,${PIXEL_B64}`],
    [MEDIA_META_PREFIX + "aud_def67890", JSON.stringify({ n: "precios", d: "", mime: "audio/ogg", size: 10, at: 2 })],
  ]);

  it("canal con soporte: media resuelta con URL pública y voice en ogg", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      ["Aquí está:\n[[media: img_abc12345]]\n[[media: aud_def67890]]"],
      makeEnv(store),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].chunks).toEqual(["Aquí está:"]);
    expect(sent[0].media).toEqual([
      { kind: "image", url: "https://bot.example.com/media/img_abc12345" },
      { kind: "audio", url: "https://bot.example.com/media/aud_def67890", voice: true },
    ]);
  });

  it("canal SIN soporte (web): el link va en el texto, sin campo media", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "web", "u1",
      ["Mira:\n[[media: img_abc12345]]"],
      makeEnv(store),
    );
    expect(sent[0].media).toBeUndefined();
    expect(sent[0].chunks[0]).toContain("https://bot.example.com/media/img_abc12345");
  });

  it("id inventado por el modelo: se descarta y el texto sale normal", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      ["Te muestro:\n[[media: img_zzzzz9999]]"],
      makeEnv(store),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].chunks).toEqual(["Te muestro:"]);
    expect(sent[0].media).toBeUndefined();
  });

  it("sin base URL propia: media omitida, texto intacto", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      ["Va:\n[[media: img_abc12345]]"],
      makeEnv(store, { DASHBOARD_BASE_URL: "" } as Partial<Env>),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].chunks).toEqual(["Va:"]);
    expect(sent[0].media).toBeUndefined();
  });

  it("respuesta que era SOLO marcador: sale la media sin chunks de texto", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "telegram", "u2",
      ["[[media: img_abc12345]]"],
      makeEnv(store),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].chunks).toEqual([]);
    expect(sent[0].media).toHaveLength(1);
  });
});

describe("escenarios reales (inmobiliaria / modo URL)", () => {
  // Catálogo estilo inmobiliaria: 3 fotos de una propiedad por URL externa
  // (Supabase) + 1 audio self-hosted + 1 foto self-hosted.
  const store = new Map<string, string>([
    [MEDIA_META_PREFIX + "img_polanco001", JSON.stringify({ n: "polanco-fachada", d: "fachada casa Polanco", mime: "image/jpeg", size: 0, at: 1, url: "https://xyz.supabase.co/storage/v1/object/public/props/polanco-1.jpg" })],
    [MEDIA_META_PREFIX + "img_polanco002", JSON.stringify({ n: "polanco-cocina", d: "cocina casa Polanco", mime: "image/jpeg", size: 0, at: 2, url: "https://xyz.supabase.co/storage/v1/object/public/props/polanco-2.jpg" })],
    [MEDIA_META_PREFIX + "img_polanco003", JSON.stringify({ n: "polanco-jardin", d: "jardín casa Polanco", mime: "image/jpeg", size: 0, at: 3, url: "https://xyz.supabase.co/storage/v1/object/public/props/polanco-3.jpg" })],
    [MEDIA_META_PREFIX + "aud_tourvoz001", JSON.stringify({ n: "tour-voz", d: "audio del asesor", mime: "audio/ogg", size: 10, at: 4 })],
    [MEDIA_BLOB_PREFIX + "aud_tourvoz001", `data:audio/ogg;base64,${PIXEL_B64}`],
    [MEDIA_META_PREFIX + "img_localfoto1", JSON.stringify({ n: "local", d: "", mime: "image/png", size: 10, at: 5 })],
    [MEDIA_BLOB_PREFIX + "img_localfoto1", `data:image/png;base64,${PIXEL_B64}`],
    // asset por URL con extensión .ogg → voice aunque no traiga mime
    [MEDIA_META_PREFIX + "aud_urlvoz0001", JSON.stringify({ n: "voz-url", d: "", mime: "", size: 0, at: 6, url: "https://cdn.negocio.com/nota.ogg" })],
  ]);

  function envCon(base: string | undefined, extra: Partial<Env> = {}): Env {
    const d1 = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              run: async () => ({ success: true }),
              first: async () => {
                if (/SELECT value FROM settings WHERE key = \?/i.test(sql)) {
                  const v = store.get(String(params[0]));
                  return v === undefined ? null : { value: v };
                }
                return null;
              },
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as unknown as D1Database;
    return { DB: d1, DASHBOARD_BASE_URL: base ?? "", ...extra } as unknown as Env;
  }

  function makeAdapter(sent: OutgoingReply[]): ChannelAdapter {
    return {
      parseIncoming: async () => { throw new Error("no-op"); },
      sendReply: async (r) => { sent.push(r); },
    };
  }

  it("inmobiliaria: 3 fotos de la propiedad + UN texto con la info, en orden", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      [
        "Casa en Polanco: 3 recámaras, 320 m², $4.2M MXN. Disponible para visita esta semana.\n[[media: img_polanco001]]\n[[media: img_polanco002]]\n[[media: img_polanco003]]",
      ],
      envCon("https://bot.example.com"),
    );
    expect(sent).toHaveLength(1);
    // La info va UNA vez, sin marcadores ni rastro de ellos.
    expect(sent[0].chunks).toEqual(["Casa en Polanco: 3 recámaras, 320 m², $4.2M MXN. Disponible para visita esta semana."]);
    expect(sent[0].media?.map((m) => m.url)).toEqual([
      "https://xyz.supabase.co/storage/v1/object/public/props/polanco-1.jpg",
      "https://xyz.supabase.co/storage/v1/object/public/props/polanco-2.jpg",
      "https://xyz.supabase.co/storage/v1/object/public/props/polanco-3.jpg",
    ]);
  });

  it("catálogo 100% por URL externa funciona SIN base URL propia", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      ["Mira la fachada:\n[[media: img_polanco001]]"],
      envCon(undefined), // sin DASHBOARD_BASE_URL ni self_origin
    );
    expect(sent[0].media).toEqual([
      { kind: "image", url: "https://xyz.supabase.co/storage/v1/object/public/props/polanco-1.jpg" },
    ]);
  });

  it("mixto: externa usa su URL y self-hosted usa la base del bot", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "telegram", "u9",
      ["Va:\n[[media: img_polanco001]]\n[[media: img_localfoto1]]"],
      envCon("https://bot.example.com"),
    );
    expect(sent[0].media?.map((m) => m.url)).toEqual([
      "https://xyz.supabase.co/storage/v1/object/public/props/polanco-1.jpg",
      "https://bot.example.com/media/img_localfoto1",
    ]);
  });

  it("voice: por mime (self-hosted ogg) y por extensión .ogg (URL externa)", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "telegram", "u9",
      ["Escucha:\n[[media: aud_tourvoz001]]\n[[media: aud_urlvoz0001]]"],
      envCon("https://bot.example.com"),
    );
    expect(sent[0].media).toEqual([
      { kind: "audio", url: "https://bot.example.com/media/aud_tourvoz001", voice: true },
      { kind: "audio", url: "https://cdn.negocio.com/nota.ogg", voice: true },
    ]);
  });

  it("marcador a MITAD del texto (modelo desobediente): se limpia y el texto queda coherente", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      ["La cocina [[media: img_polanco002]] está recién remodelada, con isla central."],
      envCon("https://bot.example.com"),
    );
    expect(sent[0].chunks[0]).not.toContain("[[");
    expect(sent[0].chunks[0]).toContain("La cocina");
    expect(sent[0].chunks[0]).toContain("está recién remodelada, con isla central.");
    expect(sent[0].media).toHaveLength(1);
  });

  it("marcadores repartidos en varios chunks: se juntan todos", async () => {
    const sent: OutgoingReply[] = [];
    await sendChunkedReply(
      makeAdapter(sent), "whatsapp", "521555",
      ["Te muestro la fachada:\n[[media: img_polanco001]]", "Y la cocina:\n[[media: img_polanco002]]"],
      envCon("https://bot.example.com"),
    );
    expect(sent[0].chunks).toEqual(["Te muestro la fachada:", "Y la cocina:"]);
    expect(sent[0].media).toHaveLength(2);
  });
});

describe("captions por imagen ([[media: id | texto]])", () => {
  it("extrae el caption y lo recorta a 300", () => {
    const r = extraeMediaIds(["Mira:\n[[media: img_abc12345 | Aquí vive la sección de Superpoderes]]"]);
    expect(r.medias).toEqual([{ id: "img_abc12345", caption: "Aquí vive la sección de Superpoderes" }]);
    expect(r.chunks).toEqual(["Mira:"]);
  });

  it("mezcla con y sin caption, en orden", () => {
    const r = extraeMediaIds([
      "[[media: img_abc12345 | Paso 1: entra al panel]]\n[[media: img_zzz99999]]",
    ]);
    expect(r.medias).toEqual([
      { id: "img_abc12345", caption: "Paso 1: entra al panel" },
      { id: "img_zzz99999" },
    ]);
  });
});

describe("marcador de video", () => {
  it("extrae [[media: vid_...]] con caption igual que fotos", async () => {
    const { extraeMediaIds } = await import("../src/replies/sender");
    const { chunks, medias } = extraeMediaIds(["Mira el recorrido:\n[[media: vid_x7k2m9q4fp | Tour completo]]"]);
    expect(medias).toEqual([{ id: "vid_x7k2m9q4fp", caption: "Tour completo" }]);
    expect(chunks[0]).toBe("Mira el recorrido:");
  });
});
