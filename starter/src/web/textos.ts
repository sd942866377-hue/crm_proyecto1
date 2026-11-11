/**
 * Lo que el VISITANTE lee en el chat del sitio web.
 *
 * Sigue el idioma del BOT, no el del panel — y esa distinción importa: el dueño
 * puede tener su panel en inglés porque a él le acomoda, y sus clientes seguir
 * hablando español. Lo que ve el cliente lo manda el idioma con el que el bot
 * atiende, no el idioma en que su dueño administra.
 *
 * Si el bot está en "espeja al cliente", el widget cae a español: la interfaz
 * se pinta ANTES de que el visitante escriba, así que todavía no hay idioma que
 * espejar.
 *
 * Van dentro del script servido, ya resueltos: el navegador del visitante no
 * carga diccionarios ni decide nada.
 */
import { descripcionIdioma, IDIOMAS, type CodigoIdioma } from "../idioma";

export interface TextosWidget {
  contestaAlInstante: string;
  saludoPorDefecto: string;
  escribeTuMensaje: string;
  abrirChat: string;
  cerrarChat: string;
  tuMensaje: string;
  enviar: string;
  chatCon: string; // "Chat con {negocio}"
  errorLimiteSesion: string;
  errorLimiteIp: string;
  errorLimiteGlobal: string;
  errorOrigen: string;
  errorGenerico: string;
  errorEnvio: string;
  // Página de demo (/demo): el prospecto que la abre habla el idioma del bot.
  demoEnLinea: string;
  demoOgDescripcion: string;
  demoAsistenteDe: string; // "Asistente de {negocio}"
  demoSaludo: string; // lleva {negocio}
  demoSeAcabo: string;
  demoErrorGenerico: string;
  demoSinConexion: string;
}

/**
 * Todo el objeto viaja por JSON.stringify hasta el navegador del visitante, así
 * que aquí no puede haber funciones: se perderían en silencio. Los textos con
 * hueco usan {negocio} y se rellenan con esto.
 */
export function conNegocio(plantilla: string, negocio: string): string {
  return plantilla.split("{negocio}").join(negocio);
}

/**
 * El `lang=` del <html>. Importa más de lo que parece: es lo que hace que un
 * lector de pantalla pronuncie el texto con el acento correcto y que el
 * navegador ofrezca traducir (o no) la página.
 */
export function htmlLang(botLanguage: string): string {
  return CODIGO_HTML[codigoDeIdioma(botLanguage)];
}

const CODIGO_HTML: Record<CodigoIdioma, string> = {
  "es-419": "es",
  "es-ES": "es-ES",
  en: "en",
  "pt-BR": "pt-BR",
};

const ES: TextosWidget = {
  contestaAlInstante: "Contesta al instante",
  saludoPorDefecto: "¡Hola! ¿En qué te puedo ayudar?",
  escribeTuMensaje: "Escribe tu mensaje…",
  abrirChat: "Abrir el chat",
  cerrarChat: "Cerrar el chat",
  tuMensaje: "Tu mensaje",
  enviar: "Enviar",
  chatCon: "Chat con",
  errorLimiteSesion:
    "Llegamos al límite de esta conversación. Escríbenos por otro medio y seguimos.",
  errorLimiteIp: "Has enviado muchos mensajes hoy. Inténtalo de nuevo mañana.",
  errorLimiteGlobal:
    "Estamos recibiendo muchos mensajes en este momento. Vuelve a intentarlo más tarde o escríbenos por otro medio.",
  errorOrigen: "Este chat no está habilitado en este sitio.",
  errorGenerico: "Algo falló de nuestro lado. Inténtalo de nuevo en un momento.",
  errorEnvio: "No se pudo enviar. Revisa tu conexión e inténtalo otra vez.",
  demoEnLinea: "En línea",
  demoOgDescripcion: "Escríbele. Contesta al instante, 24/7.",
  demoAsistenteDe: "Asistente de",
  demoSaludo:
    "¡Hola! 👋 Soy el asistente de <b>{negocio}</b>. Pregúntame lo que quieras — precios, horarios, o agenda una cita.",
  demoSeAcabo: "Se acabó la demo 🙂 Escríbele al dueño para seguir la conversación.",
  demoErrorGenerico: "Ups, algo falló. Intenta de nuevo.",
  demoSinConexion: "Sin conexión. Revisa tu internet.",
};

const ES_ES: TextosWidget = {
  ...ES,
  saludoPorDefecto: "¡Hola! ¿En qué puedo ayudarte?",
  demoSaludo:
    "¡Hola! 👋 Soy el asistente de <b>{negocio}</b>. Pregúntame lo que quieras — precios, horarios, o reserva una cita.",
  errorLimiteSesion:
    "Hemos llegado al límite de esta conversación. Escríbenos por otro medio y seguimos.",
  errorLimiteIp: "Has enviado muchos mensajes hoy. Vuelve a intentarlo mañana.",
  errorEnvio: "No se ha podido enviar. Revisa tu conexión e inténtalo otra vez.",
};

const EN: TextosWidget = {
  contestaAlInstante: "Replies right away",
  saludoPorDefecto: "Hi! How can I help?",
  escribeTuMensaje: "Type your message…",
  abrirChat: "Open chat",
  cerrarChat: "Close chat",
  tuMensaje: "Your message",
  enviar: "Send",
  chatCon: "Chat with",
  errorLimiteSesion:
    "We've reached the limit for this conversation. Reach out another way and we'll pick it up.",
  errorLimiteIp: "You've sent a lot of messages today. Try again tomorrow.",
  errorLimiteGlobal:
    "We're getting a lot of messages right now. Try again later or reach out another way.",
  errorOrigen: "This chat isn't enabled on this site.",
  errorGenerico: "Something broke on our end. Try again in a moment.",
  errorEnvio: "Couldn't send. Check your connection and try again.",
  demoEnLinea: "Online",
  demoOgDescripcion: "Message us. Instant replies, 24/7.",
  demoAsistenteDe: "Assistant at",
  demoSaludo:
    "Hi! 👋 I'm the assistant at <b>{negocio}</b>. Ask me anything — prices, hours, or book an appointment.",
  demoSeAcabo: "That's the end of the demo 🙂 Message the owner to keep the conversation going.",
  demoErrorGenerico: "Oops, something broke. Try again.",
  demoSinConexion: "No connection. Check your internet.",
};

const PT_BR: TextosWidget = {
  contestaAlInstante: "Responde na hora",
  saludoPorDefecto: "Oi! Como posso ajudar?",
  escribeTuMensaje: "Escreva sua mensagem…",
  abrirChat: "Abrir o chat",
  cerrarChat: "Fechar o chat",
  tuMensaje: "Sua mensagem",
  enviar: "Enviar",
  chatCon: "Chat com",
  errorLimiteSesion:
    "Chegamos ao limite desta conversa. Fale com a gente por outro canal e seguimos.",
  errorLimiteIp: "Você enviou muitas mensagens hoje. Tente de novo amanhã.",
  errorLimiteGlobal:
    "Estamos recebendo muitas mensagens agora. Tente mais tarde ou fale com a gente por outro canal.",
  errorOrigen: "Este chat não está habilitado neste site.",
  errorGenerico: "Algo falhou do nosso lado. Tente de novo em um instante.",
  errorEnvio: "Não deu para enviar. Confira sua conexão e tente de novo.",
  demoEnLinea: "Online",
  demoOgDescripcion: "Fale com a gente. Resposta na hora, 24/7.",
  demoAsistenteDe: "Assistente de",
  demoSaludo:
    "Oi! 👋 Sou o assistente de <b>{negocio}</b>. Pergunte o que quiser — preços, horários, ou agende um horário.",
  demoSeAcabo: "A demo terminou 🙂 Fale com o dono para continuar a conversa.",
  demoErrorGenerico: "Ops, algo falhou. Tente de novo.",
  demoSinConexion: "Sem conexão. Confira sua internet.",
};

const POR_IDIOMA: Record<CodigoIdioma, TextosWidget> = {
  "es-419": ES,
  "es-ES": ES_ES,
  en: EN,
  "pt-BR": PT_BR,
};

/**
 * Textos del widget para el idioma con el que atiende el bot.
 * Acepta lo que traiga BOT_LANGUAGE, incluidos los valores viejos ("es-MX").
 */
export function textosWidget(botLanguage: string): TextosWidget {
  return POR_IDIOMA[codigoDeIdioma(botLanguage)];
}

/** A cuál de los cuatro idiomas corresponde lo que traiga BOT_LANGUAGE. */
export function codigoDeIdioma(botLanguage: string): CodigoIdioma {
  const v = (botLanguage || "").trim();
  if (v in POR_IDIOMA) return v as CodigoIdioma;

  // Mismo criterio que descripcionIdioma, para que el widget y el bot nunca
  // queden en idiomas distintos.
  const desc = descripcionIdioma(v);
  for (const [codigo, def] of Object.entries(IDIOMAS)) {
    if (def.prompt === desc) return codigo as CodigoIdioma;
  }
  return "es-419";
}
