import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { MagicLinksRepo } from "../../src/db/magicLinks";

let repo: MagicLinksRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  repo = new MagicLinksRepo(new Db(d1 as any));
});

describe("MagicLinksRepo", () => {
  it("create returns a token; consume returns the row once", async () => {
    const token = await repo.create("hugo@x.com");
    const link = await repo.consume(token);
    expect(link?.email).toBe("hugo@x.com");
    const replay = await repo.consume(token);
    expect(replay).toBeNull();
  });

  it("consume rejects unknown tokens", async () => {
    expect(await repo.consume("nonexistent")).toBeNull();
  });

  it("purgeExpired clears used + expired", async () => {
    const t = await repo.create("a@x.com");
    await repo.consume(t);
    const cleaned = await repo.purgeExpired();
    expect(cleaned).toBeGreaterThanOrEqual(1);
  });

  it("dos canjes concurrentes del MISMO token — solo UNO gana (TOCTOU fix)", async () => {
    const token = await repo.create("race@x.com");
    // Antes: SELECT→check-en-JS→UPDATE dejaba una ventana donde dos consume()
    // en vuelo podían leer used_at=null los dos antes de que cualquiera
    // escribiera. Ahora la condición vive en el WHERE del UPDATE — SQLite
    // serializa las dos escrituras y solo una puede cambiar la fila.
    const [a, b] = await Promise.all([repo.consume(token), repo.consume(token)]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.email).toBe("race@x.com");
  });

  it("consume rechaza un token ya vencido (expires_at < now)", async () => {
    const token = await repo.create("expired@x.com", -1); // ttl negativo = ya vencido
    expect(await repo.consume(token)).toBeNull();
  });
});
