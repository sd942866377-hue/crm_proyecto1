/**
 * El archivo que sirve `GET /widget.js`.
 *
 * Se escribe como un string porque el navegador del visitante lo ejecuta tal
 * cual: sin build, sin dependencias, sin framework. Tiene que funcionar igual
 * en un sitio hecho con Claude Code, en WordPress y en un Shopify — así que no
 * asume nada del entorno y no toca nada fuera de su propio nodo.
 *
 * Todo va dentro de un Shadow DOM: los estilos del sitio no pueden romper el
 * widget, y el widget no puede romper el sitio. Es la única forma de que se vea
 * igual en una plantilla de WordPress de 2014 y en un Next.js recién hecho.
 *
 * Los 8 estilos (4 × 2 formatos) viajan dentro del archivo. Pesa unos pocos KB
 * de más y a cambio el dueño cambia el look editando un atributo, sin desplegar
 * nada y sin que el visitante pida otro archivo.
 */
import type { Env } from "../env";
import {
  ICONO_BURBUJA,
  MARKUP_PANEL,
  normalizaColor,
  normalizaModo,
  normalizaTema,
  todosLosTemas,
  type Modo,
  type Tema,
} from "./temas";
import { textosWidget, type TextosWidget } from "./textos";

/** Los textos van dentro de atributos del markup; se escapan al insertarlos. */
function escapaHtml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
}

export interface Opciones {
  origen: string; // https://<worker> — de dónde salen las peticiones
  nombre: string; // nombre del negocio en la cabecera
  saludo: string; // primer mensaje del bot
  color: string; // color de marca
  posicion: "derecha" | "izquierda";
  tema: Tema;
  modo: Modo;
  /** Selector del contenedor donde se incrusta (solo en modo ventana). */
  destino: string;
  /** Lo que lee el visitante, ya resuelto al idioma con el que atiende el bot. */
  textos: TextosWidget;
}

export function widgetScript(o: Opciones): string {
  const { textos, ...resto } = o;
  const cfg = JSON.stringify(resto);
  const temas = JSON.stringify(todosLosTemas());
  // El markup viaja con los textos ya puestos: el navegador del visitante no
  // sustituye nada más que el nombre del negocio. Se reemplaza con función
  // para que un `$` en un texto traducido no active los patrones de replace.
  const huecos: Record<string, string> = {
    __INSTANTE__: textos.contestaAlInstante,
    __CERRAR__: textos.cerrarChat,
    __ESCRIBE__: textos.escribeTuMensaje,
    __TUMSJ__: textos.tuMensaje,
    __ENVIAR__: textos.enviar,
  };
  const markup = MARKUP_PANEL.replace(
    /__(?:INSTANTE|CERRAR|ESCRIBE|TUMSJ|ENVIAR)__/g,
    (h) => escapaHtml(huecos[h] ?? ""),
  );
  return `(function(){
  "use strict";
  var CFG = ${cfg};
  var TXT = ${JSON.stringify(textos)};
  var TEMAS = ${temas};
  var MARKUP = ${JSON.stringify(markup)};
  var ICONO = ${JSON.stringify(ICONO_BURBUJA)};

  // Los atributos del <script> ganan sobre la configuración del panel: así el
  // dueño ajusta look, saludo o formato sin volver a desplegar el bot.
  var el = document.currentScript;
  if (el) {
    ["nombre","saludo","color","posicion","tema","modo","destino"].forEach(function(k){
      var v = el.getAttribute("data-" + k);
      if (v) CFG[k] = v;
    });
  }
  if (!TEMAS[CFG.tema + ":" + CFG.modo]) { CFG.tema = "suave"; CFG.modo = "burbuja"; }
  if (window.__forjaWidget) return; // dos veces el script = un solo chat
  window.__forjaWidget = true;

  var LS = "forja_web_session";
  var sid = null;
  try { sid = localStorage.getItem(LS); } catch (e) {}

  // El <script> puede ir en el <head> o antes del contenedor de destino, así
  // que no se monta nada hasta que el documento esté armado.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }

  function montar(){
    var incrustado = CFG.modo === "ventana";
    var contenedor = null;
    if (incrustado) {
      contenedor = CFG.destino ? document.querySelector(CFG.destino) : null;
      if (!contenedor) {
        // Sin contenedor no hay dónde incrustarlo. Antes que desaparecer sin
        // explicación, lo decimos en la consola y caemos a la burbuja.
        if (window.console) console.warn("[Forja] No encontré el contenedor " + CFG.destino + "; muestro el chat como burbuja.");
        incrustado = false;
        CFG.modo = "burbuja";
      }
    }

    var host = document.createElement("div");
    host.setAttribute("data-forja-widget", "");
    // Flotante: el nodo anfitrión no debe heredar nada del sitio (un
    // "div{margin:1rem}" global movería el chat). "all:initial" no borra las
    // variables, por eso se fijan después.
    if (!incrustado) host.style.cssText = "all:initial";
    host.style.setProperty("--fc", CFG.color);
    host.style.setProperty("--der", CFG.posicion === "izquierda" ? "auto" : "20px");
    host.style.setProperty("--izq", CFG.posicion === "izquierda" ? "20px" : "auto");
    var raiz = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    (incrustado ? contenedor : document.body).appendChild(host);

    var css = document.createElement("style");
    css.textContent = TEMAS[CFG.tema + ":" + CFG.modo];
    raiz.appendChild(css);

    var burbuja = null;
    if (!incrustado) {
      burbuja = document.createElement("button");
      burbuja.className = "burbuja";
      burbuja.setAttribute("aria-label", TXT.abrirChat);
      burbuja.innerHTML = ICONO;
      raiz.appendChild(burbuja);
    }

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", incrustado ? "region" : "dialog");
    panel.setAttribute("aria-label", TXT.chatCon + " " + CFG.nombre);
    panel.innerHTML = MARKUP.replace("__NOMBRE__", esc(CFG.nombre));
    raiz.appendChild(panel);

    var chat = panel.querySelector(".chat");
    var ta = panel.querySelector("textarea");
    var btnEnviar = panel.querySelector(".enviar");
    var desde = 0, sondeo = null, esperando = false, saludado = false;

    function esc(s){ return String(s).replace(/[<>&"]/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]; }); }

    function agrega(texto, quien, clase){
      var f = document.createElement("div"); f.className = "fila " + quien;
      var b = document.createElement("div"); b.className = "bub" + (clase ? " " + clase : "");
      b.textContent = texto; f.appendChild(b); chat.appendChild(f);
      chat.scrollTop = chat.scrollHeight;
    }
    function escribiendo(){
      if (panel.querySelector(".fila.esperando")) return;
      var f = document.createElement("div"); f.className = "fila bot esperando";
      f.innerHTML = '<div class="bub esc"><i></i><i></i><i></i></div>';
      chat.appendChild(f); chat.scrollTop = chat.scrollHeight;
    }
    function paraEscribir(){
      var e = panel.querySelector(".fila.esperando"); if (e) e.remove();
    }

    function abrir(){
      panel.classList.add("abierto");
      saluda();
      ta.focus();
      if (!sondeo) sondeo = setInterval(sondear, 2500);
    }
    function cerrar(){
      panel.classList.remove("abierto");
      if (sondeo) { clearInterval(sondeo); sondeo = null; }
    }
    function saluda(){
      if (saludado) return;
      agrega(CFG.saludo, "bot"); saludado = true;
    }

    if (burbuja) {
      burbuja.addEventListener("click", function(){
        panel.classList.contains("abierto") ? cerrar() : abrir();
      });
      panel.querySelector(".cerrar").addEventListener("click", cerrar);
      document.addEventListener("keydown", function(e){
        if (e.key === "Escape" && panel.classList.contains("abierto")) cerrar();
      });
    } else {
      // Incrustado: siempre visible, así que saluda y escucha desde el inicio.
      saluda();
      if (!sondeo) sondeo = setInterval(sondear, 2500);
    }

    ta.addEventListener("input", function(){
      ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 110) + "px";
    });
    ta.addEventListener("keydown", function(e){
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    btnEnviar.addEventListener("click", enviar);

    function enviar(){
      var texto = (ta.value || "").trim();
      if (!texto || esperando) return;
      agrega(texto, "yo");
      ta.value = ""; ta.style.height = "auto";
      esperando = true; btnEnviar.disabled = true; escribiendo();

      fetch(CFG.origen + "/web/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sid, text: texto })
      })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d && d.sessionId && d.sessionId !== sid) {
            sid = d.sessionId;
            try { localStorage.setItem(LS, sid); } catch (e) {}
          }
          if (!d || !d.ok) {
            paraEscribir(); esperando = false; btnEnviar.disabled = false;
            agrega(mensajeDeError(d && d.error), "bot", "aviso");
            return;
          }
          if (!sondeo) sondeo = setInterval(sondear, 2500);
        })
        .catch(function(){
          paraEscribir(); esperando = false; btnEnviar.disabled = false;
          agrega(TXT.errorEnvio, "bot", "aviso");
        });
    }

    function mensajeDeError(codigo){
      if (codigo === "limite_sesion") return TXT.errorLimiteSesion;
      if (codigo === "limite_ip") return TXT.errorLimiteIp;
      // Tope del canal entero: no es culpa del visitante, así que no se le
      // regaña ni se le dice que "hay un límite" — se le da una salida.
      if (codigo === "limite_global") return TXT.errorLimiteGlobal;
      if (codigo === "origen_no_permitido") return TXT.errorOrigen;
      return TXT.errorGenerico;
    }

    function sondear(){
      if (!sid) return;
      fetch(CFG.origen + "/web/poll?session=" + encodeURIComponent(sid) + "&after=" + desde)
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (!d || !d.ok || !d.messages || !d.messages.length) return;
          paraEscribir(); esperando = false; btnEnviar.disabled = false;
          d.messages.forEach(function(m){ agrega(m.content, "bot"); desde = Math.max(desde, m.created_at); });
        })
        .catch(function(){});
    }
  }
})();`;
}

/** Configuración del widget, leída del panel con caída a valores sensatos. */
export async function widgetOpciones(env: Env, origen: string): Promise<Opciones> {
  const { SettingsRepo } = await import("../db/settings");
  const { Db } = await import("../db/client");
  const s = new SettingsRepo(new Db(env.DB));
  const [nombre, saludo, color, posicion, tema, modo, destino] = await Promise.all([
    s.get("web_widget_nombre"),
    s.get("web_widget_saludo"),
    s.get("web_widget_color"),
    s.get("web_widget_posicion"),
    s.get("web_widget_tema"),
    s.get("web_widget_modo"),
    s.get("web_widget_destino"),
  ]);
  // El idioma del BOT, no el del panel: el dueño puede administrar en inglés y
  // atender clientes en español.
  const textos = textosWidget(env.BOT_LANGUAGE || "");
  return {
    origen,
    textos,
    nombre: nombre || env.BUSINESS_NAME || "Chat",
    // Solo si el dueño no escribió su propio saludo en el panel: ese siempre gana.
    saludo: saludo || textos.saludoPorDefecto,
    color: normalizaColor(color),
    posicion: posicion === "izquierda" ? "izquierda" : "derecha",
    tema: normalizaTema(tema),
    modo: normalizaModo(modo),
    destino: destino || "#forja-chat",
  };
}
