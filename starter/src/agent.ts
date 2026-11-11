import { Agent } from "agents";
import { applyLanguage } from "./idioma";
import { streamText } from "ai";
import type { SystemModelMessage } from "ai";
import type { Env } from "./env";
import { Db } from "./db/client";
import { ConversationsRepo } from "./db/conversations";
import { MessagesRepo } from "./db/messages";
import { isPro } from "./config";
import { resolveAgentConfig } from "./settings-loader";
import { SETTING_KEYS, SettingsRepo } from "./db/settings";
import { isValidTimezone } from "./businessContext";
import { maskTelegramToken, unmaskTelegramToken } from "./telegramFiles";
import { buildTools } from "./tools";
import { buildMultimodalUserMessage } from "./media/vision";
import { chunkReply } from "./replies/chunker";
import { pickAdapter } from "./replies/sender";
import { selectModel } from "./upgrade/modelSelector";
import type { Tier } from "./upgrade/modelSelector";
import { dateAnchorBlock } from "./time/dateAnchor";
import { monthIaCostUsd, applyBudgetGuard } from "./budget";
import { CustomerFactsRepo } from "./db/facts";
import { createModel } from "./llm/provider";
import { costOfUsage } from "./pricing";
import { recordIaUsage } from "./db/ia-usage";
import type { ChannelId } from "./channels/shared";
import type { SearchKbResult } from "./tools/searchKb";
import { dispatchMobilePush } from "./mobile-push";
import { renderPush } from "./lib/push-templates";
import { TEST_CHANNEL } from "./db/testFilter";
import { mapMessageToAiTurn } from "./history";
import { maskContact } from "./lib/mask";

// Mensaje fijo cuando el LLM falló del todo (primario + retries + fallback).
// No se verifica en el Blindaje: no afirma ningún dato.
const LLM_FAILURE_REPLY = "Algo falló de mi lado, intenta de nuevo en un momento.";

// El cliente mandó un archivo (PDF/doc) sin nada escrito. El bot no lo lee: se
// lo pasa a una persona y se lo dice, para no dejarlo en visto.
const FILE_RECEIVED_REPLY =
  "Recibí tu archivo 📄 — se lo paso a una persona del equipo para revisarlo.";

// Máx 1 push tipo `message` (Forja Inbox móvil, conversación pausada) cada
// este intervalo — evita que una ráfaga de mensajes del cliente (15 seguidos)
// mande 15 notificaciones seguidas. Mismo espíritu que HOT_PUSH_THROTTLE_MS
// en db/leads.ts, pero por-conversación vía estado del DO (ver lastMessagePushAt).
const MESSAGE_PUSH_THROTTLE_MS = 2 * 60 * 1000;
// Preview del mensaje del cliente en el push: recortado, NUNCA el transcript
// completo — mismo largo que usa el preview de la lista de conversaciones
// (api-inbox.ts GET /conversations).
const MESSAGE_PUSH_PREVIEW_LEN = 140;

export interface SupportAgentState {
  conversationId: string | null;
  channel: string;
  channelUserId: string;
  pendingMessages: { text: string; receivedAt: number }[];
  lastAlarmAt: number;
  lastUserLang: string;
  toolCallsInLast2Turns: number;
  lastSearchKbScore: number;
  imageRetryCount: number;
  /** Último push tipo `message` (Forja Inbox móvil) mandado mientras esta
   *  conversación estaba pausada. Throttle: máx 1 cada MESSAGE_PUSH_THROTTLE_MS
   *  para que 15 mensajes seguidos del cliente no manden 15 notificaciones. Vive
   *  en el estado del DO (uno por conversación — misma llave channel+channelUserId
   *  que usa agentStub) en vez de D1: no hace falta tabla nueva y ya es
   *  inherentemente por-conversación. */
  lastMessagePushAt: number;
  /** Filas de `media` capturadas para el turno que está en el buffer. Se ligan
   *  al mensaje `user` en processBuffer (el id del mensaje no existe cuando se
   *  captura el archivo). */
  pendingMediaIds: string[];
}

export interface AgentIncomingPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  /** Duración de la nota de voz, cuando el canal la da (Telegram). */
  audioDurationS?: number;
  /** Documento/PDF del cliente: el bot no lo lee, lo escala a una persona. */
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
  isOwnerMessage?: boolean;
}

interface ProcessedMedia {
  processedText: string;
  hasImage: boolean;
  /** Ids de `media` capturados en este payload. */
  mediaIds: string[];
  /** Llegó un documento que el bot no puede leer. */
  fileReceived: boolean;
  /** El documento venía con texto propio (caption) → el bot sí contesta eso. */
  fileHasText: boolean;
}

export class SupportAgent extends Agent<Env, SupportAgentState> {
  initialState: SupportAgentState = {
    conversationId: null,
    channel: "",
    channelUserId: "",
    pendingMessages: [],
    lastAlarmAt: 0,
    lastUserLang: "es",
    toolCallsInLast2Turns: 0,
    lastSearchKbScore: 1,
    imageRetryCount: 0,
    lastMessagePushAt: 0,
    pendingMediaIds: [],
  };

  /**
   * Called by the Worker fetch handler when a webhook arrives for this user.
   * Buffers the message, schedules/resets an alarm.
   */
  async ingest(payload: AgentIncomingPayload): Promise<{ acknowledged: true }> {
    // El DO del chat corre en su propio env y NO pasa por el middleware del
    // Worker: aplicamos el tier efectivo aquí para que Forja+ (visión, tools
    // Pro, Blindaje) se prenda/apague en el chat también. Cache 30s por isolate.
    const { applyTier } = await import("./tier");
    await applyTier(this.env);
    await applyLanguage(this.env);

    const db = new Db(this.env.DB);
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate(
      payload.channel,
      payload.channelUserId,
      payload.displayName,
    );
    this.setState({
      ...this.state,
      channel: payload.channel,
      channelUserId: payload.channelUserId,
      conversationId: conv.id,
    });

    // NOTA: antes, un mensaje del dueño (isOwnerMessage) auto-pausaba la
    // conversación 60 min. Pero ese flag SOLO lo pone el canal de Telegram, y
    // solo cuando el remitente es el propio dueño (channelUserId ==
    // OWNER_TELEGRAM_CHAT_ID). En Telegram 1-a-1 el dueño no puede escribir en
    // el hilo de un cliente, así que ese flag nunca es una intervención real:
    // siempre es el dueño PROBANDO su bot como si fuera cliente. Auto-pausar ahí
    // creaba un ciclo — reanudar → probar → re-pausa (reportado 30-jul-2026).
    //
    // La pausa por intervención real se hace desde el panel (inbox → responder /
    // Pausar), que sí respeta takeover_minutes. Aquí el mensaje del dueño sigue
    // su curso normal para que el bot le responda y pueda probarlo.

    // Media se procesa ANTES de las pausas: una conversación en pausa igual debe
    // dejar el mensaje del cliente en el panel, y legible — la transcripción de la
    // nota de voz, no "(audio)".
    const media = await this.processMedia(payload, db, conv.id);
    const { processedText, hasImage } = media;

    // Conversación en pausa (un humano tomó el control): el bot se calla, pero el
    // mensaje del cliente DEBE registrarse — si no, nunca aparece en el panel y el
    // equipo no tiene qué contestar a mano (que es el punto de pausar). Visto en
    // prod (2026-07-29). Reportado por conconfianza.
    if (await convs.isPaused(conv.id)) {
      await this.recordWithoutReplying(db, conv.id, processedText, media.mediaIds);
      // Ping a la app móvil (Forja Inbox): el cliente escribió mientras un
      // humano atiende ESTA conversación — justo el momento en que el dueño
      // quiere enterarse. Throttle 1/conversación cada MESSAGE_PUSH_THROTTLE_MS
      // (si no, una ráfaga de mensajes manda una notificación por cada uno).
      // this.ctx.waitUntil (NO await): esta rama corre dentro de ingest(), que
      // routeToAgent espera para mandar el ack HTTP al canal — un canal lento
      // o caído en el control plane no debe colgar ese ack hasta 5s. waitUntil
      // mantiene el isolate vivo lo suficiente para que el fetch best-effort de
      // dispatchMobilePush termine, sin bloquear la respuesta.
      // El chat de prueba nunca notifica: quien escribe ES el dueño, y la app
      // ya está mirando la pantalla de la prueba (ver db/testFilter.ts).
      const now = Date.now();
      if (payload.channel !== TEST_CHANNEL && now - this.state.lastMessagePushAt > MESSAGE_PUSH_THROTTLE_MS) {
        this.setState({ ...this.state, lastMessagePushAt: now });
        // contact_hint enmascarado (nunca el teléfono/usuario crudo) — mismo
        // criterio de privacidad que /api/conversations.
        const cliente = conv.display_name || maskContact(conv.channel_user_id) || "Cliente";
        // Preview corto, recortado — NUNCA el transcript completo (ver comentario
        // en mobile-push.ts). Sin texto propio del cliente (una foto suelta, un
        // PDF), el preview describe el archivo en vez de salir vacío o con
        // marcadores internos.
        const preview = (await this.pushPreview(processedText, payload))
          .replace(/\s+/g, " ")
          .slice(0, MESSAGE_PUSH_PREVIEW_LEN);
        const push = renderPush("message", { cliente, preview });
        this.ctx.waitUntil(
          dispatchMobilePush(this.env, {
            type: "message",
            title: push.title,
            body: push.body,
            conversationId: conv.id,
          }),
        );
      }
      return { acknowledged: true };
    }

    // Keyword del modo evento (QUIERO/RECURSOS): se cuenta para el embudo y el
    // mensaje SIGUE su camino al agente (LLM) — el playbook de qué hacer con la
    // keyword vive en el system prompt. Solo le quitamos la espera del buffer.
    // El chat de prueba NO ensucia el embudo del evento: la keyword se ignora
    // para keyword_hits (el mensaje sigue su camino normal al agente).
    let isEventKeyword = false;
    if (payload.text && !payload.audioUrl && !payload.imageUrl && payload.channel !== TEST_CHANNEL) {
      const { logKeywordHit } = await import("./tools/masterclass");
      isEventKeyword = (await logKeywordHit(this.env, payload.text, conv.id)) !== null;
    }

    // Guardrail anti-abuso. El tope diario de turnos aplica a TODO mensaje que
    // produce un turno (texto, AUDIO e IMAGEN incluidos) — una ráfaga de notas
    // de voz también quema la llave de IA del miembro, así que cuenta igual. El
    // anti-repetición sí es solo-texto (necesita texto para detectar la copia).
    // Las keywords del evento quedan exentas del anti-repetición.
    if (!isEventKeyword) {
      try {
        const { isRepeatSpam, SPAM_SNOOZE_MS, isOverDailyCap, DAILY_CAP_SNOOZE_MS, DAILY_CAP_MESSAGE } =
          await import("./spam");
        // Anti-repetición (solo texto).
        if (payload.text && !payload.audioUrl && !payload.imageUrl && (await isRepeatSpam(db, conv.id, payload.text))) {
          await convs.setPausedUntil(conv.id, Date.now() + SPAM_SNOOZE_MS);
          // Quien repite un mensaje casi nunca es un bot: suele ser alguien con
          // prisa que cree que no le leyeron. Callar sin avisar era indistinguible
          // de un bot roto (reporte de Eduardo Cume) — el tope diario sí se
          // despide; este guard ahora también, y deja ticket para que la pausa
          // aparezca en el panel de alguien. Best-effort: si algo falla, la
          // pausa aplica igual.
          const { REPEAT_PAUSE_MESSAGE } = await import("./spam");
          try {
            const channel = payload.channel as ChannelId;
            await new MessagesRepo(db).append(conv.id, "assistant", REPEAT_PAUSE_MESSAGE);
            await pickAdapter(channel).sendReply(
              { channel, channelUserId: payload.channelUserId, chunks: [REPEAT_PAUSE_MESSAGE] },
              this.env,
            );
            const { createHandoffTicket } = await import("./tools/handoffHuman");
            await createHandoffTicket(this.env, {
              conversationId: conv.id,
              reason: "conversación pausada (mensajes repetidos)",
              summary: `El cliente mandó el mismo mensaje varias veces ("${payload.text.slice(0, 120)}") y la conversación quedó en pausa 1 hora. Puede ser alguien con prisa: échale un ojo y contéstale tú si hace falta.`,
              category: "other",
            });
          } catch (e) {
            console.warn("[spam-guard] aviso/ticket del anti-repetición falló:", e);
          }
          console.warn(`[spam-guard] conv ${conv.id} en cooldown 1h (mensaje repetido) — cliente avisado + ticket`);
          return { acknowledged: true };
        }
        // Tope diario de turnos (texto + media): despedida amable UNA vez +
        // descanso 12h. La pausa garantiza que no se repita (los siguientes
        // mensajes mueren en isPaused antes de llegar aquí).
        if (await isOverDailyCap(db, conv.id)) {
          await convs.setPausedUntil(conv.id, Date.now() + DAILY_CAP_SNOOZE_MS);
          await new MessagesRepo(db).append(conv.id, "assistant", DAILY_CAP_MESSAGE);
          const channel = payload.channel as ChannelId;
          await pickAdapter(channel).sendReply(
            { channel, channelUserId: payload.channelUserId, chunks: [DAILY_CAP_MESSAGE] },
            this.env,
          );
          console.warn(`[spam-guard] conv ${conv.id} tope diario de turnos → descanso 12h`);
          return { acknowledged: true };
        }
      } catch (e) {
        // El guard es un extra, nunca la ruta crítica: si falla, se responde normal.
        console.warn("[spam-guard] check failed:", e);
      }
    }

    // (media ya se procesó arriba, antes de las pausas — ver processMedia)

    // Archivo del cliente (PDF/doc): el bot no puede leerlo, así que lo escala a
    // una persona. El contenido del archivo JAMÁS llega al LLM.
    if (media.fileReceived) {
      await this.handleIncomingFile(db, conv, payload);
      // Solo el archivo (sin nada escrito): no hay nada que contestarle al LLM.
      // Se registra el mensaje, se le avisa al cliente con una línea fija y se
      // corta aquí — sin armar la alarma del buffer.
      if (!media.fileHasText) {
        await this.recordWithoutReplying(db, conv.id, processedText, media.mediaIds);
        try {
          const channel = payload.channel as ChannelId;
          await new MessagesRepo(db).append(conv.id, "assistant", FILE_RECEIVED_REPLY);
          await pickAdapter(channel).sendReply(
            { channel, channelUserId: payload.channelUserId, chunks: [FILE_RECEIVED_REPLY] },
            this.env,
          );
        } catch (e) {
          console.error("[ingest] aviso de archivo recibido falló:", e);
        }
        return { acknowledged: true };
      }
    }

    // Append to buffer (we always persist the client's message)
    const pending = [
      ...this.state.pendingMessages,
      { text: processedText, receivedAt: Date.now() },
    ];
    this.setState({
      ...this.state,
      pendingMessages: pending,
      imageRetryCount: hasImage ? 0 : this.state.imageRetryCount,
      // Se acumulan igual que pendingMessages: el turno puede juntar varios
      // payloads (foto + texto) antes de que la alarma dispare.
      // `?? []`: un DO creado antes de esta versión trae el estado viejo, sin
      // el campo — leerlo a secas revienta con "not iterable".
      pendingMediaIds: [...(this.state.pendingMediaIds ?? []), ...media.mediaIds],
    });

    // Resolve effective config (D1 settings overlaid on env defaults).
    // We need at least bot_paused (to decide whether to reply) and the buffer.
    const cfg = await resolveAgentConfig(this.env, []);

    // Owner paused the bot via the dashboard → keep the message buffered but
    // stay silent: do NOT arm the alarm, so alarm() never runs.
    // Mismo hueco que la pausa por conversación: el mensaje solo vivía en
    // pendingMessages (estado del DO), que el panel no ve — el dueño no tenía cómo
    // leer lo que entró con el bot apagado. Se queda en buffer (igual) y ahora
    // también se registra.
    if (cfg.botPaused) {
      await this.recordWithoutReplying(db, conv.id, processedText, media.mediaIds);
      return { acknowledged: true };
    }

    // Schedule buffer processing via the agents SDK scheduler.
    // The SDK overrides alarm() to dispatch named callbacks from its
    // cf_agents_schedules table, so raw ctx.storage.setAlarm() alone won't
    // invoke our code. We upsert a fixed 'msg-buffer' row (so rapid messages
    // debounce to a single fire) and set the raw alarm as the trigger.
    // Keyword del evento → fast lane: procesa casi al instante (el cierre en
    // vivo no puede esperar el buffer completo).
    // Rescate de mensajes varados: una alarma de Cloudflare puede fallar en
    // silencio y dejar el mensaje del cliente esperando hasta que reescriba
    // (vimos a un cliente esperar 11 min y escribir "¿Hola?"). Si el más viejo del
    // buffer ya rebasó 2x el tiempo normal, no esperes otra ventana entera.
    // Reportado por conconfianza.
    // Chat de prueba → misma fast lane: el instalador está viendo la pantalla y
    // no debe esperar BUFFER_SECONDS para saber si su bot responde.
    const oldestAt = pending[0]?.receivedAt ?? Date.now();
    const hasStranded = Date.now() - oldestAt > cfg.bufferMs * 2;
    const isTestChat = payload.channel === TEST_CHANNEL;
    const alarmAt = Date.now() + (isEventKeyword || hasStranded || isTestChat ? 500 : cfg.bufferMs);
    const alarmAtSec = Math.floor(alarmAt / 1000);
    this.sql`
      INSERT OR REPLACE INTO cf_agents_schedules
        (id, callback, payload, type, time, created_at)
      VALUES
        ('msg-buffer', 'processBuffer', '{}', 'delayed', ${alarmAtSec}, unixepoch())
    `;
    await this.ctx.storage.setAlarm(alarmAt);
    // Candado barato contra la alarma perdida: si no quedó armada, reintenta una
    // vez y deja rastro en el log.
    if ((await this.ctx.storage.getAlarm()) === null) {
      console.error("[ingest] alarm was not armed — retrying");
      await this.ctx.storage.setAlarm(alarmAt);
    }
    this.setState({ ...this.state, lastAlarmAt: alarmAt });

    return { acknowledged: true };
  }

  /**
   * Audio → transcripción; imagen → marcador multimodal Pro; documento → nada al
   * LLM (ver handleIncomingFile). En los tres casos, si el bot tiene bucket R2
   * (binding MEDIA) el archivo se COPIA ahí antes de que la URL del proveedor
   * expire — las de WhatsApp mueren en 10 min y las de Telegram en ~1h, así que
   * sin esa copia el hilo móvil enseñaría enlaces muertos.
   *
   * OJO con el gating: la Bóveda (setting) controla la GALERÍA del panel; el
   * hilo móvil necesita el archivo aunque el superpoder esté apagado, así que
   * el opt-in de facto es tener el binding. Fail-open — jamás bloquea el ingest.
   *
   * Extraído de ingest() para que los caminos en pausa puedan registrar un
   * mensaje LEGIBLE (la transcripción, no un placeholder).
   */
  private async processMedia(
    payload: AgentIncomingPayload,
    db: Db,
    conversationId: string,
  ): Promise<ProcessedMedia> {
    let processedText = payload.text ?? "";
    let hasImage = false;
    const mediaIds: string[] = [];
    const { captureIncomingMedia } = await import("./media/boveda");
    const { mediaMarker, fileMarker } = await import("./lib/media-markers");

    if (payload.audioUrl) {
      // Copia primero (la URL está lo más fresca posible), transcribe después.
      const audioId = await captureIncomingMedia(this.env, db, {
        conversationId,
        url: payload.audioUrl,
        kind: "audio",
        durationS: payload.audioDurationS,
      });
      if (audioId) mediaIds.push(audioId);
      try {
        const { transcribeAudio } = await import("./media/transcribe");
        const result = await transcribeAudio(payload.audioUrl, this.env);
        processedText = result.text || "(audio sin transcripción)";
      } catch (e) {
        console.error("[ingest] transcription failed:", e);
        processedText = "(no pude entender el audio)";
      }
      if (audioId) processedText = `${processedText}\n${mediaMarker(audioId)}`;
    }

    if (payload.imageUrl) {
      hasImage = true;
      const imageId = await captureIncomingMedia(this.env, db, {
        conversationId,
        url: payload.imageUrl,
        caption: payload.text ?? undefined,
        kind: "image",
      });
      if (imageId) mediaIds.push(imageId);
      // Pro-only: if free tier, strip the image and inform the bot owner-side
      if (!isPro(this.env)) {
        processedText =
          (processedText || "") +
          "\n(El cliente mandó una imagen, pero tu plan no soporta análisis de imágenes.)";
      } else {
        processedText =
          (processedText || "(imagen sin caption)") +
          // Enmascara el token: una file URL de Telegram lo lleva dentro, y este
          // marcador se persiste en D1 (y se ve en el panel y en los exports).
          // Ver src/telegramFiles.ts. Reportado por conconfianza.
          `\n[IMAGE_URL: ${maskTelegramToken(payload.imageUrl)}]`;
      }
      // El marcador de archivo va ADEMÁS del [IMAGE_URL:], que se conserva
      // intacto: de él dependen el flujo multimodal y el Blindaje en bots ya
      // desplegados (ver lib/media-markers.ts).
      if (imageId) processedText = `${processedText}\n${mediaMarker(imageId)}`;
    }

    // Documento/PDF: hasta hoy se perdía en silencio en TODOS los canales (los
    // parsers lo descartaban). Ahora se archiva y se muestra en el hilo; el
    // contenido NUNCA va al LLM — lo revisa una persona (handleIncomingFile).
    let fileReceived = false;
    if (payload.fileUrl) {
      fileReceived = true;
      const fileId = await captureIncomingMedia(this.env, db, {
        conversationId,
        url: payload.fileUrl,
        mime: payload.fileMime,
        filename: payload.fileName,
        caption: payload.text ?? undefined,
        kind: "document",
      });
      if (fileId) mediaIds.push(fileId);
      processedText =
        (processedText ? `${processedText}\n` : "") +
        fileMarker(payload.fileName || "documento") +
        (fileId ? ` ${mediaMarker(fileId)}` : "");
    }

    return {
      processedText,
      hasImage,
      mediaIds,
      fileReceived,
      fileHasText: fileReceived && !!(payload.text ?? "").trim(),
    };
  }

  /** Texto del push: lo que escribió el cliente, o qué archivo mandó. */
  private async pushPreview(processedText: string, payload: AgentIncomingPayload): Promise<string> {
    const { stripMediaMarkers } = await import("./lib/media-markers");
    const limpio = stripMediaMarkers(processedText).replace("(imagen sin caption)", "").trim();
    if (limpio) return limpio;
    if (payload.fileUrl) return `📄 ${payload.fileName || "Archivo"}`;
    if (payload.imageUrl) return "📷 Foto";
    if (payload.audioUrl) return "🎤 Nota de voz";
    return "(archivo)";
  }

  /**
   * El cliente mandó un archivo que el bot no sabe leer. Se le avisa a una
   * persona (ticket de handoff → la conversación sale como "Te necesita" en la
   * app, sin código extra) y al cliente se le contesta una línea fija para que
   * no quede en visto. NO se pausa el bot: si el archivo venía con una pregunta
   * escrita, el bot igual la responde.
   */
  private async handleIncomingFile(
    db: Db,
    conv: { id: string; channel: string; channel_user_id: string },
    payload: AgentIncomingPayload,
  ): Promise<void> {
    try {
      // Un cliente que suelta 5 PDFs seguidos no necesita 5 tickets ni 5 avisos
      // al dueño: con la conversación ya escalada, basta.
      const abierto = await db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM tickets WHERE conversation_id = ? AND status != 'resolved'",
        [conv.id],
      );
      if ((abierto?.n ?? 0) === 0) {
        const { createHandoffTicket } = await import("./tools/handoffHuman");
        await createHandoffTicket(this.env, {
          conversationId: conv.id,
          reason: "archivo del cliente",
          summary: `El cliente mandó un archivo (${payload.fileName || payload.fileMime || "documento"}) que el bot no puede leer. Revísalo en el hilo y contéstale tú.`,
          category: "other",
        });
      }
    } catch (e) {
      console.error("[ingest] no se pudo escalar el archivo del cliente:", e);
    }
  }

  /**
   * El bot no va a responder este, pero el mensaje del cliente igual tiene que
   * llegar al panel para que un humano lo tome. Best-effort a propósito: si D1
   * falla, el webhook NO debe fallar — perder el registro es malo, devolverle un
   * error al canal es peor. Reportado por conconfianza.
   */
  private async recordWithoutReplying(
    db: Db,
    conversationId: string,
    text: string,
    mediaIds: string[] = [],
  ): Promise<void> {
    if (!text.trim()) return;
    try {
      const id = await new MessagesRepo(db).append(conversationId, "user", text);
      if (mediaIds.length) {
        const { attachMediaToMessage } = await import("./media/boveda");
        await attachMediaToMessage(db, mediaIds, id);
      }
    } catch (e) {
      console.error("[ingest] could not record the message while paused:", e);
    }
  }

  /**
   * Called by the agents SDK scheduler when the msg-buffer task fires.
   * Processes accumulated messages as one input, runs the LLM loop, and
   * sends the chunked reply over the channel adapter.
   */
  async processBuffer(): Promise<void> {
    // Despertó por alarm del DO (sin middleware): refresca el tier efectivo para
    // que el Blindaje (Pro) y el gating de la respuesta usen el valor real.
    const { applyTier } = await import("./tier");
    await applyTier(this.env);
    await applyLanguage(this.env);

    const buffered = [...this.state.pendingMessages];
    const bufferedMediaIds = [...(this.state.pendingMediaIds ?? [])];
    this.setState({ ...this.state, pendingMessages: [], pendingMediaIds: [] });
    if (buffered.length === 0) return;

    const combined = buffered.map((m) => m.text).join("\n").trim();
    if (!combined) return;

    const db = new Db(this.env.DB);
    const msgs = new MessagesRepo(db);
    const convs = new ConversationsRepo(db);
    const convId = this.state.conversationId;
    if (!convId) {
      console.warn("[SupportAgent.processBuffer] no conversation_id in state");
      return;
    }

    // Persist user message
    const userMsgId = await msgs.append(convId, "user", combined);
    // Liga los archivos de este turno al mensaje recién creado: sin esto el hilo
    // móvil los intercalaría por timestamp (heurística que con una ráfaga de
    // fotos puede pegarlos al mensaje equivocado). Best-effort.
    if (bufferedMediaIds.length) {
      const { attachMediaToMessage } = await import("./media/boveda");
      await attachMediaToMessage(db, bufferedMediaIds, userMsgId);
    }
    await convs.touchLastMessage(convId);

    // Load history (last 20)
    const history = await msgs.lastN(convId, 20);
    const aiMessages: any[] = history.slice(0, -1).map(mapMessageToAiTurn);
    // Build the LAST user message multimodal-aware: if it carries an
    // [IMAGE_URL: ...] marker AND we're on the Pro tier, attach the image.
    const lastUserMsg = history[history.length - 1];
    if (lastUserMsg) {
      const { stripMediaMarkers } = await import("./lib/media-markers");
      // Los marcadores son contabilidad interna: el modelo ve el texto limpio.
      const cleanText = stripMediaMarkers(lastUserMsg.content);
      const imgMatch = lastUserMsg.content.match(/\[IMAGE_URL: (.+?)\]/);
      if (imgMatch && isPro(this.env)) {
        // El token se enmascaró al guardar; vuelve solo aquí, para bajar el
        // archivo. Nunca sale de esta llamada.
        const imageUrl = unmaskTelegramToken(imgMatch[1], this.env.TELEGRAM_BOT_TOKEN);
        aiMessages.push(buildMultimodalUserMessage(cleanText, imageUrl));
      } else {
        aiMessages.push({ role: "user", content: cleanText });
      }
    }

    // Blindaje anti-invento: pasajes de KB consultados ESTE turno. searchKb
    // los stashea vía callback — el verificador pre-envío los usa como fuente
    // de verdad y el selector de modelo aprovecha el score real (antes
    // lastSearchKbScore era un campo muerto que nunca se actualizaba).
    let turnKbPassages: SearchKbResult[] = [];
    let turnUsedKb = false;
    let lastKbTopScore = 1;

    // Build tools registry (tier-gated in buildTools)
    const tools = buildTools({
      env: this.env,
      getConversationId: () => convId,
      onSearchKb: (results) => {
        turnUsedKb = true;
        turnKbPassages = [...turnKbPassages, ...results].slice(-10);
        lastKbTopScore = results[0]?.score ?? 0;
      },
    });
    const toolNames = Object.keys(tools);

    // Resolve effective config (D1 settings overlaid on env defaults).
    const cfg = await resolveAgentConfig(this.env, toolNames, this.state.channel || undefined);

    // Honor the dashboard's tool toggles: the prompt already only advertises
    // enabled tools (settings-loader), so the registry must match.
    const enabledTools = Object.fromEntries(
      Object.entries(tools).filter(([name]) => cfg.enabledToolNames.includes(name)),
    );

    // Bots que toman pedidos/citas/reservas: el flujo es de varios pasos y el tier
    // barato lo aplasta en un solo mensaje (reportado por bots de restaurante). Con
    // estas tools activas, el modo "auto" arranca en el modelo inteligente para que
    // respete el "un paso a la vez". Ver selectModel + MODEL_CONTROL.
    const INTAKE_TOOLS = ["tomarPedido", "crearReservacion", "scheduleAppointment", "agendarCita"];
    const isTransactional = INTAKE_TOOLS.some((t) => cfg.enabledToolNames.includes(t));

    // Select tier: honor an explicit override, otherwise auto-select. The active
    // provider (Anthropic default | OpenAI) maps the tier to a concrete model id.
    let tier: Tier =
      cfg.modelOverride === "haiku"
        ? "fast"
        : cfg.modelOverride === "sonnet"
          ? "smart"
          : selectModel({
              toolCallsInLast2Turns: this.state.toolCallsInLast2Turns,
              lastUserText: combined,
              lastUserLang: this.env.BOT_LANGUAGE,
              hasImage: false,
              imageRetryCount: this.state.imageRetryCount,
              lastSearchKbScore: this.state.lastSearchKbScore,
              transactional: isTransactional,
            });

    // Budget guard: al presupuesto baja al modelo barato (sigue respondiendo);
    // al 2× del presupuesto CORTA para proteger la llave del miembro de una
    // fuga (bot en loop). Default $25/mes (settings-loader). Fail-open: si el
    // cálculo de costo falla (D1), NO bloquea el turno — la respuesta sale.
    if (cfg.monthlyBudgetUsd !== undefined) {
      let guard: { tier: typeof tier; downgraded: boolean; stop: boolean } | null = null;
      let spent = 0;
      try {
        spent = await monthIaCostUsd(db);
        guard = applyBudgetGuard(tier, spent, cfg.monthlyBudgetUsd);
      } catch (e) {
        console.warn("[budget] cálculo de costo falló, se ignora el guard este turno:", e);
      }
      if (guard?.stop) {
        console.error(
          `[SupportAgent] HARD STOP — gasto $${spent.toFixed(2)} ≥ 2× tope $${cfg.monthlyBudgetUsd}. El bot descansa para proteger tu llave de IA.`,
        );
        try {
          const { notifyBudgetHardStop } = await import("./tools/handoffHuman");
          await notifyBudgetHardStop(this.env, db, spent, cfg.monthlyBudgetUsd);
        } catch (e) {
          console.warn("[budget] notify failed:", e);
        }
        return; // no gasta más LLM este turno
      }
      if (guard?.downgraded) {
        console.warn(
          `[SupportAgent] monthly budget reached ($${spent.toFixed(2)}/$${cfg.monthlyBudgetUsd}) — downgrading to fast tier`,
        );
      }
      if (guard) tier = guard.tier;
    }

    const { model, modelId, supportsPromptCache } = createModel(this.env, tier, cfg.llm);

    // Cache the (large, stable) system prompt with an ephemeral cache breakpoint.
    // Only the system block is cached — messages change every turn. Cache hits
    // show up in usage.cachedInputTokens (read below for cost accounting).
    // Prompt caching is Anthropic-only; on OpenAI we send the plain system block.
    const system: SystemModelMessage[] = [
      {
        role: "system",
        content: cfg.systemPrompt,
        ...(supportsPromptCache
          ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
          : {}),
      },
    ];

    // Ancla temporal (bloque UNCACHED, como la memoria del cliente): sin esto el
    // bot no sabe qué día es hoy y el modelo inventa el año al resolver fechas
    // relativas ("el jueves 27") → consulta/agenda una fecha pasada y escala en
    // vez de agendar. El prompt grande de arriba sigue cacheado intacto.
    // La timezone que el dueño eligió en "Disponibilidad" (setting business_hours)
    // manda sobre el env: así el "hoy" del bot cuadra con la zona real del negocio.
    let tzOverride: string | undefined;
    try {
      const raw = await new SettingsRepo(new Db(this.env.DB)).get(SETTING_KEYS.businessHours);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidTimezone(parsed?.timezone)) tzOverride = parsed.timezone;
      }
    } catch {
      /* setting ausente/malformado → cae al env, como siempre */
    }
    system.push({ role: "system", content: dateAnchorBlock(this.env, undefined, tzOverride) });

    // Customer memory (flywheel): facts extracted by the insights analyzer are
    // injected as a small UNCACHED system block, so a returning customer is
    // greeted by a bot that remembers them. The big prompt above stays cached.
    // Memory is an enhancement, never the critical path: if the lookup fails,
    // the reply still goes out.
    try {
      const facts = await new CustomerFactsRepo(db).forConversation(convId, 8);
      if (facts.length > 0) {
        system.push({
          role: "system",
          content: `<cliente>\nLo que ya sabes de este cliente (de conversaciones pasadas):\n${facts
            .map((f) => `- ${f.fact}`)
            .join("\n")}\n</cliente>`,
        });
      }
    } catch (e) {
      console.warn("[SupportAgent] customer facts lookup failed:", e);
    }

    // Canal de la conversación (bloque chico, sin caché): el playbook puede
    // cambiar por canal — ej. registro conversacional en WhatsApp vs mandar el
    // link en Instagram. Sin esto el modelo no tiene forma de saber dónde está.
    // El chat de prueba NO anuncia canal a propósito: decirle "esto es una
    // prueba" cambiaría cómo contesta y la prueba dejaría de ser fiel.
    if (this.state.channel && this.state.channel !== TEST_CHANNEL) {
      const CANAL_HUMANO: Record<string, string> = {
        twilio: "WhatsApp",
        whatsapp: "WhatsApp",
        manychat: "Instagram (DMs vía ManyChat)",
        instagram: "Instagram",
        messenger: "Facebook Messenger",
        telegram: "Telegram",
      };
      system.push({
        role: "system",
        content: `<canal>Esta conversación es por ${CANAL_HUMANO[this.state.channel] ?? this.state.channel}.</canal>`,
      });
    }

    // Composio (integraciones genéricas, superpoder Pro): si el miembro
    // conectó apps vía Composio, anuncia sus tools disponibles — la tool
    // "composio" (tools/composio.ts) solo sabe ejecutar por slug; sin este
    // bloque el modelo no sabría qué slugs existen. Bloque chico, sin caché
    // (el catálogo de apps conectadas puede cambiar entre turnos).
    if (isPro(this.env)) {
      try {
        const { composioEnabled, listConnectedTools, getComposioContext } = await import(
          "./integrations/composio"
        );
        if (composioEnabled(this.env)) {
          const [composioTools, composioContext] = await Promise.all([
            listConnectedTools(this.env),
            getComposioContext(this.env),
          ]);
          if (composioTools.length > 0) {
            const toolLines = composioTools
              .map((t) => {
                const params = t.requiredParams.length ? ` (params: ${t.requiredParams.join(", ")})` : "";
                return `- ${t.slug}${params}: ${t.description}`;
              })
              .join("\n");
            const contextEntries = Object.entries(composioContext).filter(
              ([, cfg]) => cfg && typeof cfg === "object",
            );
            const contextBlock = contextEntries.length
              ? `\n\nCONTEXTO CONFIGURADO POR EL DUEÑO — usa estos valores por default cuando llames las tools de esa app, sin preguntarle ni adivinar:\n${contextEntries
                  .map(([toolkit, cfg]) => {
                    const fields = Object.entries(cfg as Record<string, unknown>)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(", ");
                    return `- ${toolkit} → ${fields}`;
                  })
                  .join("\n")}`
              : "";
            system.push({
              role: "system",
              content: `<integraciones_composio>\nApps conectadas por el dueño vía Composio. Para usarlas, llama la tool "composio" con { tool_slug, arguments }, incluyendo los params requeridos que se listan entre paréntesis:\n${toolLines}${contextBlock}\n</integraciones_composio>`,
            });
          }
        }
      } catch (e) {
        console.warn("[SupportAgent] composio tools lookup failed:", e);
      }
    }

    // A/B de estrategia de venta (modo evento): a cada conversación le toca un
    // "vendedor" fijo. Bloque chico y sin caché, igual que la memoria.
    {
      const { hasMasterclassMode, salesStrategyBlock } = await import("./tools/masterclass");
      if (hasMasterclassMode(this.env)) {
        system.push({ role: "system", content: salesStrategyBlock(convId) });
      }
    }

    let assistantText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let cacheCreationTokens = 0;
    let toolCallCount = 0;
    let toolCallsMade: { toolName: string; input: unknown }[] = [];
    // Salidas de las tools del turno (excepto searchKb, que ya va en
    // turnKbPassages). El Blindaje las usa como FUENTE oficial: un dato que sale
    // de una tool (catálogo, inventario, una tool custom del miembro) NO es
    // inventado — antes se bloqueaban listados válidos por no verlas.
    let turnToolResults: { tool: string; output: string }[] = [];
    let usedModelId = modelId;

    // Corre el loop del LLM con un modelo dado; deja los resultados en las vars.
    const attempt = async (m: any, mId: string = modelId) => {
      // Anthropic Opus 4.7+/gen 5 rechazan temperature con 400 — ahí se ignora
      // la del dashboard en vez de tumbar cada respuesta (modelAcceptsTemperature).
      const { modelAcceptsTemperature } = await import("./llm/provider");
      const conTemp = cfg.temperature !== undefined && modelAcceptsTemperature(mId);
      const result = streamText({
        model: m,
        system,
        messages: aiMessages,
        tools: enabledTools,
        stopWhen: ({ steps }) => steps.length >= 6,
        ...(conTemp ? { temperature: cfg.temperature } : {}),
      });
      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
      }
      assistantText = text;
      const usage = await result.usage;
      inputTokens = usage?.inputTokens ?? 0;
      outputTokens = usage?.outputTokens ?? 0;
      // AI SDK v7: los cache-read tokens se movieron de usage.cachedInputTokens
      // a usage.inputTokenDetails.cacheReadTokens. inputTokens sigue siendo el
      // TOTAL (incluye cached), así que costOfUsage((input - cached)…) no cambia.
      cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
      // cache-CREATION (escribir el prompt al caché la 1ª vez) vive en la
      // metadata específica de Anthropic; usage.inputTokens ya la incluye en el
      // total, pero cuesta 1.25× — la libreta la separa para cobrarla bien.
      const provMeta = (await result.providerMetadata) as
        | { anthropic?: { cacheCreationInputTokens?: number } }
        | undefined;
      cacheCreationTokens = provMeta?.anthropic?.cacheCreationInputTokens ?? 0;
      const steps = await result.steps;
      toolCallCount = steps.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0);
      // Persist what the agent DID (not just what it said): tool name + input,
      // feeding the dashboard's thread chips, stats and the Mi Agente counters.
      toolCallsMade = steps.flatMap((s) =>
        (s.toolCalls ?? []).map((tc: any) => ({
          toolName: tc.toolName as string,
          input: tc.input,
        })),
      );
      // Salidas de las tools (excepto searchKb, ya cubierto por turnKbPassages):
      // fuente de verdad para el Blindaje. Cada salida se acota para no inflar el
      // prompt del verificador.
      turnToolResults = steps
        .flatMap((s: any) => s.toolResults ?? [])
        .filter((tr: any) => tr?.toolName && tr.toolName !== "searchKb")
        .map((tr: any) => ({
          tool: String(tr.toolName),
          output: (typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output ?? tr.result ?? "")).slice(0, 4000),
        }));
    };

    try {
      await attempt(model);
    } catch (e: any) {
      // FAILOVER con backoff: en ráfagas (historias) el primario suele dar un
      // rate-limit TRANSITORIO — esperar con jitter y reintentar resuelve la
      // mayoría; si no, se prueba el proveedor alterno (también con un segundo
      // intento). El jitter des-sincroniza mensajes que llegaron en el mismo
      // segundo. El bot no puede quedarse mudo el día del evento.
      console.error("[SupportAgent.processBuffer] streamText failed:", e);
      const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const { fallbackModel } = await import("./llm/provider");
      const primary = createModel(this.env, tier, cfg.llm);
      const fb = fallbackModel(this.env, tier, primary.provider);
      let ok = false;

      await backoff(2000 + Math.floor(Math.random() * 1500));
      try {
        await attempt(model);
        ok = true;
      } catch (e1: any) {
        console.error("[SupportAgent.processBuffer] primary retry failed:", e1);
      }

      if (!ok && fb) {
        console.warn(
          `[SupportAgent] failover ${primary.provider} → ${fb.provider}/${fb.modelId}`,
        );
        try {
          await attempt(fb.model, fb.modelId);
          usedModelId = fb.modelId;
          ok = true;
        } catch (e2: any) {
          console.error("[SupportAgent.processBuffer] fallback failed:", e2);
          await backoff(2500 + Math.floor(Math.random() * 1500));
          try {
            await attempt(fb.model, fb.modelId);
            usedModelId = fb.modelId;
            ok = true;
          } catch (e3: any) {
            console.error("[SupportAgent.processBuffer] fallback retry failed:", e3);
          }
        }
      }

      // Último recurso para turnos con FOTO: si NINGÚN modelo pudo (p. ej. un
      // modelo BYO sin visión rechaza el mensaje multimodal), Workers AI
      // describe la imagen (sin llave extra) y se reintenta el primario con
      // puro texto — el cliente recibe respuesta en vez del "no pude procesar".
      if (!ok) {
        const ultimo: any = aiMessages[aiMessages.length - 1];
        const imgPart = Array.isArray(ultimo?.content)
          ? ultimo.content.find((p: any) => p?.type === "image")
          : null;
        if (imgPart) {
          try {
            const { describeImage } = await import("./media/vision");
            const desc = await describeImage(this.env, String(imgPart.image));
            if (desc) {
              const textPart = ultimo.content.find((p: any) => p?.type === "text");
              aiMessages[aiMessages.length - 1] = {
                role: "user",
                content: `${textPart?.text ?? ""}\n[El cliente mandó una FOTO. Descripción de la imagen: ${desc}]`.trim(),
              };
              await attempt(model);
              ok = true;
              console.warn("[vision] turno con foto rescatado con la descripción de Workers AI (modelo sin visión)");
            }
          } catch (eImg: any) {
            console.error("[vision] describe+reintento falló:", eImg);
          }
        }
      }

      if (!ok) {
        assistantText = LLM_FAILURE_REPLY;
      }
    }

    // ── Blindaje anti-invento (Pro): verificación pre-envío ──────────────────
    // Antes de mandar una respuesta que afirme datos (precio/horario/promesa),
    // se contrasta contra los pasajes de KB del turno + contexto del negocio.
    // Sin respaldo → sale un "déjame confirmarlo" y se avisa al dueño (ticket,
    // misma maquinaria del handoff). FAIL-OPEN: cualquier error/timeout del
    // verificador manda la respuesta original intacta — jamás bloquea un envío.
    if (assistantText && assistantText !== LLM_FAILURE_REPLY && cfg.blindajeEnabled) {
      try {
        const { guardReply } = await import("./blindaje/verify");
        const guard = await guardReply(this.env, {
          replyText: assistantText,
          turnUsedKb,
          kbPassages: turnKbPassages,
          toolResults: turnToolResults,
          businessContext: cfg.businessContext,
          systemPrompt: cfg.systemPrompt,
          // Los datos que el propio cliente dio (nombre/contacto/hora) respaldan
          // la recapitulación de una cita — sin esto el juez la tumbaba siempre.
          mensajesDelCliente: history
            .filter((m) => m.role === "user")
            .slice(-6)
            .map((m) => m.content),
          // Lo que el negocio YA le dijo a este cliente (campañas del dueño,
          // respuestas previas del bot o de un humano) respalda repetirlo —
          // "fogateros" de la campaña vs "fogatas" de la KB es el mismo dato.
          mensajesDelNegocio: history
            .filter((m) => m.role === "assistant" || m.role === "owner")
            .slice(-6)
            .map((m) => m.content),
          mode: cfg.blindajeMode,
          conversationId: convId,
          channel: this.state.channel,
          llm: cfg.llm,
        });
        if (guard.action === "replaced") {
          assistantText = guard.finalText;
        }
      } catch (e) {
        console.warn("[blindaje] guard falló — fail-open, va la respuesta original:", e);
      }
    }

    // Persist assistant message (with usage + model_used + tool calls)
    await msgs.append(convId, "assistant", assistantText, {
      modelUsed: usedModelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: cachedTokens,
      toolCalls: toolCallsMade.length > 0 ? toolCallsMade : undefined,
    });

    // Libreta de gastos: anota la conversación con su costo fino (caché-creation
    // a 1.25×). Aditivo — el guard sigue leyendo `messages`; esto es para el
    // desglose por función que ve la app. Fail-safe adentro.
    await recordIaUsage(db, {
      fn: "conversacion",
      model: usedModelId,
      usage: {
        input: inputTokens,
        cached: cachedTokens,
        cacheCreation: cacheCreationTokens,
        output: outputTokens,
      },
      conversationId: convId,
    });

    // Update state for next turn. lastSearchKbScore = score top-1 de la última
    // búsqueda en KB del turno: si vino débil (<0.5) el selector sube a "smart"
    // el siguiente turno (upgrade/modelSelector). Sin búsqueda este turno
    // regresa a neutral (1) — el boost dura un turno, igual que
    // toolCallsInLast2Turns.
    this.setState({
      ...this.state,
      toolCallsInLast2Turns: toolCallCount,
      lastSearchKbScore: turnUsedKb ? lastKbTopScore : 1,
    });

    // Chunk + send via the channel adapter. SIEMPRE por sendChunkedReply: ahí
    // viven los marcadores ([[botones: …]] y [[media: …]]) — un sendReply
    // directo aquí los dejaba pasar CRUDOS al cliente (bug real, visto en el
    // demo de IG con la Galería).
    const chunks = chunkReply(assistantText, cfg.maxChunks);
    const channel = this.state.channel as ChannelId;
    const adapter = pickAdapter(channel);
    const { sendChunkedReply } = await import("./replies/sender");
    await sendChunkedReply(
      adapter,
      channel,
      this.state.channelUserId,
      chunks,
      this.env,
      cfg.interChunkDelayMs,
    );

    console.log(
      `[SupportAgent.processBuffer] sent ${chunks.length} chunks, model=${usedModelId}, cost=$${costOfUsage(
        usedModelId,
        { input: inputTokens, cached: cachedTokens, output: outputTokens },
      ).toFixed(5)}`,
    );
  }
}
