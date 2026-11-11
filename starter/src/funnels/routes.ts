// Endpoint /funnels — crear/listar/borrar embudos de comentarios por reel desde
// fuera (tu CRM, un script, o el agente-dueño). Auth con FUNNEL_API_TOKEN
// (header X-Funnel-Token). Se monta en /funnels desde index.ts.
import { Hono } from "hono";
import type { Env } from "../env";
import { Db } from "../db/client";
import { listFunnels, saveFunnel, deleteFunnel } from "./store";
import { resolveReelToMediaId } from "./reel";

export const funnelsApp = new Hono<{ Bindings: Env }>();

function authed(token: string | undefined, expected: string | undefined): boolean {
  const p = token ?? "";
  const e = expected ?? "";
  if (!e || p.length !== e.length) return false;
  let diff = 0;
  for (let i = 0; i < e.length; i++) diff |= p.charCodeAt(i) ^ e.charCodeAt(i);
  return diff === 0;
}

funnelsApp.use("*", async (c, next) => {
  if (!authed(c.req.header("x-funnel-token"), c.env.FUNNEL_API_TOKEN)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  await next();
});

funnelsApp.get("/", async (c) => {
  const funnels = await listFunnels(new Db(c.env.DB));
  return c.json({ ok: true, funnels });
});

// { reelUrl?, mediaId?, keyword, resource, dm?, buttonLabel?, publicReply? }
// Resuelve reelUrl → mediaId (o usa mediaId directo). keyword requerido.
funnelsApp.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const keyword = String(body.keyword ?? "").trim();
  if (!keyword) return c.json({ ok: false, error: "keyword requerido" }, 400);

  let mediaId: string | undefined = body.mediaId ? String(body.mediaId) : undefined;
  if (!mediaId && body.reelUrl) {
    const resolved = await resolveReelToMediaId(String(body.reelUrl), c.env);
    if (!resolved) return c.json({ ok: false, error: "no encontré ese reel en /me/media" }, 404);
    mediaId = resolved;
  }

  const rule = await saveFunnel(new Db(c.env.DB), {
    mediaId,
    keyword,
    dm: String(body.dm ?? "¡Gracias por tu interés! 🎉 Dale al botón de abajo 👇"),
    buttonLabel: String(body.buttonLabel ?? "Obtener"),
    resource: String(body.resource ?? ""),
    publicReply: body.publicReply ? String(body.publicReply) : undefined,
  });
  return c.json({ ok: true, funnel: rule });
});

funnelsApp.delete("/:id", async (c) => {
  const ok = await deleteFunnel(new Db(c.env.DB), c.req.param("id"));
  return c.json({ ok });
});
