import type { Env } from "../env";
import { isPro } from "../config";
import { getNiche, APPOINTMENT_NICHE_IDS } from "../niches";
import { searchKbTool, type SearchKbResult } from "./searchKb";
import { handoffHumanTool } from "./handoffHuman";
import { pauseBotTool } from "./pauseBot";
import { snoozeUserTool } from "./snoozeUser";
import { pauseSuspectedBotTool } from "./pauseSuspectedBot";
import { captureLeadTool } from "./captureLead";
import { scheduleAppointmentTool } from "./scheduleAppointment";
import { catalogQueryTool } from "./catalogQuery";
import { crearReservacionTool, tomarPedidoTool } from "./restaurante";
import { calificarCompradorTool, registrarVisitaTool } from "./inmobiliaria";
import { agendarCitaTool, verDisponibilidadTool, cancelarCitaTool } from "./servicios";
import { registrarPedidoTool } from "./comercio";
import { registrarProspectoTool } from "./crm";
import { reservarHospedajeTool, cotizarEventoTool } from "./hoteleria";
import { calcomConfigured } from "../integrations/calcom";
import {
  hasMasterclassMode,
  eventInfoTool,
  trackedLinkTool,
  registerMasterclassTool,
} from "./masterclass";
import { forjaLicenseStatusTool } from "./forjaSupport";
import { submitAuditCaseTool } from "./auditCase";
import { forjaFeatureTool } from "./forjaFeature";
import { sendPaymentLinkTool } from "./cobros";
import { stripeConfigured } from "../integrations/stripe";
import { composioTool } from "./composio";
import { composioEnabled } from "../integrations/composio";
import { loadMemberTools, mergeMemberTools } from "./member";

export interface ToolContext {
  env: Env;
  getConversationId: () => string | null;
  /** Blindaje anti-invento: el agente captura los pasajes de KB del turno. */
  onSearchKb?: (results: SearchKbResult[]) => void;
}

export function buildTools(ctx: ToolContext) {
  // Free tier base set. captureLead y scheduleAppointment van aquí a propósito: el
  // bot Starter (free) captura prospectos Y agenda citas (Cal.com lo conecta el dueño
  // con su propia cuenta/llave, sin costo para Forja). Los giros de cita usan su propio
  // agendarCita (más abajo). Lo Pro es catálogo/inventario, cobros y Composio.
  const tools: Record<string, any> = {
    searchKb: searchKbTool(ctx.env, ctx.onSearchKb),
    handoffHuman: handoffHumanTool(ctx.env, ctx.getConversationId),
    pauseBot: pauseBotTool(ctx.env, ctx.getConversationId),
    snoozeUser: snoozeUserTool(ctx.env, ctx.getConversationId),
    pauseSuspectedBot: pauseSuspectedBotTool(ctx.env, ctx.getConversationId),
    captureLead: captureLeadTool(ctx.env, ctx.getConversationId),
    scheduleAppointment: scheduleAppointmentTool(ctx.env, ctx.getConversationId),
  };

  // Soporte Forja (solo la instancia de Horizontes: requiere URL + token).
  if (ctx.env.FORJA_SUPPORT_URL && ctx.env.FORJA_SUPPORT_TOKEN) {
    tools.forjaLicenseStatus = forjaLicenseStatusTool(ctx.env);
  }

  // Modo auditoría (dinámica masterclass, instancia Horizontes).
  if (ctx.env.AUDIT_MODE === "on") {
    tools.submitAuditCase = submitAuditCaseTool(ctx.env, ctx.getConversationId);
  }

  // Recopilación de funciones para Forja (historia de IG, instancia Horizontes).
  if (ctx.env.FEATURE_MODE === "on") {
    tools.forjaFeature = forjaFeatureTool(ctx.env, ctx.getConversationId);
  }

  // Pro tier additions
  if (isPro(ctx.env)) {
    tools.catalogQuery = catalogQueryTool(ctx.env);
    // Cobros por WhatsApp: solo si el miembro conectó su llave de Stripe.
    if (stripeConfigured(ctx.env)) {
      tools.sendPaymentLink = sendPaymentLinkTool(ctx.env, ctx.getConversationId);
    }
    // Composio (integraciones genéricas): solo si el miembro conectó su
    // llave de Composio. El catálogo de tools disponibles (qué apps puede
    // usar) se anuncia en el system prompt — ver agent.ts.
    if (composioEnabled(ctx.env)) {
      tools.composio = composioTool(ctx.env);
    }
  }

  // Tools específicas del nicho (BOT_NICHE). Se cargan por giro, no por tier:
  // un restaurante toma reservaciones y pedidos; una inmobiliaria califica
  // compradores; los giros de cita comparten agendarCita; los de comercio,
  // registrarPedido. (Método único por ahora: agendarCita registra la cita sin
  // depender de una agenda externa; Cal.com se documenta como método adicional.)
  const nicheId = getNiche(ctx.env).id;
  // Giros de cita (APPOINTMENT_NICHE_IDS, fuente única en niches/index.ts):
  // comparten agendarCita. El bloque `scheduling` del Centro de Mantenimiento
  // lee esa MISMA lista, así "quién agenda" nunca diverge de "quién registra la
  // tool". El resto de los giros va por el switch.
  if (APPOINTMENT_NICHE_IDS.has(nicheId)) {
    tools.agendarCita = agendarCitaTool(ctx.env, ctx.getConversationId);
    // Sin tool de cancelar, el modelo "cancelaba" con lenguaje natural (y al
    // reagendar creaba una SEGUNDA cita) — reporte de Eduardo Cume.
    tools.cancelarCita = cancelarCitaTool(ctx.env, ctx.getConversationId);
    // Método adicional: si el dueño conectó Cal.com, el bot consulta
    // disponibilidad real antes de reservar (agendarCita hace la reserva).
    if (calcomConfigured(ctx.env)) {
      tools.verDisponibilidad = verDisponibilidadTool(ctx.env, ctx.getConversationId);
    }
  } else {
    switch (nicheId) {
      case "restaurante":
        tools.crearReservacion = crearReservacionTool(ctx.env, ctx.getConversationId);
        tools.tomarPedido = tomarPedidoTool(ctx.env, ctx.getConversationId);
        break;
      case "inmobiliaria":
        tools.calificarComprador = calificarCompradorTool(ctx.env, ctx.getConversationId);
        tools.registrarVisita = registrarVisitaTool(ctx.env, ctx.getConversationId);
        break;
      case "tienda":
      case "panaderia":
      case "cafeteria":
        tools.registrarPedido = registrarPedidoTool(ctx.env, ctx.getConversationId);
        break;
      case "crm":
        tools.registrarProspecto = registrarProspectoTool(ctx.env, ctx.getConversationId);
        break;
      case "hoteleria":
        tools.reservarHospedaje = reservarHospedajeTool(ctx.env, ctx.getConversationId);
        tools.cotizarEvento = cotizarEventoTool(ctx.env, ctx.getConversationId);
        break;
    }
  }

  // agendarCita es el método canónico de citas del giro (registra + reserva en
  // Cal.com). Sustituye al scheduleAppointment genérico para no duplicar tools.
  if (tools.agendarCita) delete tools.scheduleAppointment;

  // Modo evento/masterclass (opt-in por env EVENT_*): info exacta del evento,
  // links de trackeo por cliente y registro conversacional.
  if (hasMasterclassMode(ctx.env)) {
    tools.eventInfo = eventInfoTool(ctx.env);
    tools.trackedLink = trackedLinkTool(ctx.env, ctx.getConversationId);
    if (ctx.env.REGISTRATION_WEBHOOK_URL) {
      tools.registerMasterclass = registerMasterclassTool(ctx.env, ctx.getConversationId);
    }
  }

  // Tools custom del miembro (member/tools.local.ts). Van AL FINAL y el core
  // gana ante choque de nombre: una tool del miembro nunca pisa una tool base
  // (p. ej. searchKb), solo agrega las suyas. Sobreviven cada `forjabot update`.
  mergeMemberTools(
    tools,
    loadMemberTools({ env: ctx.env, getConversationId: ctx.getConversationId }),
  );

  return tools;
}
