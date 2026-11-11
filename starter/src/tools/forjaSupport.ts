import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";

// Tool de soporte de Horizontes (solo la instancia de Santi): consulta el
// estado REAL de una licencia de Forja en el license server. Se registra
// únicamente cuando FORJA_SUPPORT_URL + FORJA_SUPPORT_TOKEN están configurados,
// así el template queda inerte para los bots de los miembros.
export function forjaLicenseStatusTool(env: Env) {
  return tool({
    description:
      "Consulta el estado real de una licencia de Forja por correo o por llave HZN-. Úsala SOLO en casos de soporte de Forja y SOLO con el correo/llave que la persona dice que es suyo. Devuelve por licencia: plan, status (active/suspended/revoked), event_code (si vino de un código como FORJA26), permanent (true = ya es de por vida), expired y expires_at.",
    inputSchema: z.object({
      // Regex sin lookaround: .email() de Zod rompe los schemas estrictos de OpenAI.
      email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "email inválido").optional().describe("Correo con el que activó su licencia"),
      key: z.string().optional().describe("Llave completa HZN-XXXX-XXXX-XXXX"),
    }),
    execute: async ({ email, key }) => {
      if (!email && !key) return { error: "bad_input" as const, message: "se necesita correo o llave" };
      try {
        const q = email ? `email=${encodeURIComponent(email)}` : `key=${encodeURIComponent(key ?? "")}`;
        const res = await fetch(`${env.FORJA_SUPPORT_URL}/v1/support/license?${q}`, {
          headers: { Authorization: `Bearer ${env.FORJA_SUPPORT_TOKEN}` },
        });
        if (!res.ok) return { error: "transient" as const, message: `lookup HTTP ${res.status}` };
        return await res.json();
      } catch (e: any) {
        return { error: "transient" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
