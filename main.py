# main.py - Servidor Web API Flask y Bot de Telegram para base_rpmkt

import os
import math
import threading
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import telebot
from telebot.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

# Importar helper de base de datos
import database
import composio_agent

# Cargar variables de entorno
load_dotenv()

# 1. Inicializar la base de datos SQLite con la tabla base_rpmkt
database.init_db()

# 2. Configuración de Flask
app = Flask(__name__, static_folder='.', static_url_path='')

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/')
def index():
    """Ruta raíz que sirve el frontend de la WebApp."""
    return send_from_directory('.', 'index.html')

@app.route('/api/clientes', methods=['POST'])
def registrar_cliente():
    """Endpoint para registrar o actualizar un cliente en base_rpmkt."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No se recibieron datos JSON válidos."}), 400
        
    cliente = data.get('cliente')
    telefono = data.get('telefono')
    estado = data.get('estado')
    
    if not cliente or not telefono or not estado:
        return jsonify({"error": "Los campos 'cliente', 'telefono' y 'estado' son obligatorios."}), 400
        
    procedencia = data.get('procedencia', '')
    fecha = data.get('fecha', '')
    hora = data.get('hora', '')
    distrito = data.get('distrito', '')
    direccion = data.get('direccion', '')
    archivo_origen = data.get('archivo_origen', '')
    contacto_observacion = data.get('contacto_observacion', '')
    observacion = data.get('observacion', '')
    estado_seguimiento = data.get('estado_seguimiento', '')
    historial_contactos = data.get('historial_contactos', '')
    accion_contacto = data.get('accion_contacto', '')
    
    try:
        # Guardar en SQLite
        database.save_cliente(
            procedencia=procedencia,
            estado=estado,
            cliente=cliente,
            telefono=telefono,
            fecha=fecha,
            hora=hora,
            distrito=distrito,
            direccion=direccion,
            archivo_origen=archivo_origen,
            contacto_observacion=contacto_observacion,
            observacion=observacion,
            estado_seguimiento=estado_seguimiento,
            historial_contactos=historial_contactos,
            accion_contacto=accion_contacto
        )
        return jsonify({"status": "ok", "message": "Registro guardado exitosamente en base_rpmkt."}), 200
    except Exception as e:
        print(f"Error al registrar en base_rpmkt: {e}")
        return jsonify({"error": f"Error interno del servidor: {str(e)}"}), 500

@app.route('/api/clientes', methods=['GET'])
def listar_clientes():
    """Endpoint para retornar registros filtrados y paginados de base_rpmkt."""
    estado = request.args.get('estado', '')
    try:
        page = int(request.args.get('page', 1))
    except ValueError:
        page = 1
        
    per_page = 10
    filtro_estado = estado if estado != '' else None
    
    try:
        clientes, total_records = database.get_clientes(filtro_estado, page=page, per_page=per_page)
        pages = math.ceil(total_records / per_page)
        
        return jsonify({
            "clientes": clientes,
            "total": total_records,
            "pages": pages,
            "current_page": page
        }), 200
    except Exception as e:
        print(f"Error al consultar base_rpmkt: {e}")
        return jsonify({"error": f"Error al realizar la consulta: {str(e)}"}), 500


# 3. Endpoints de Composio (IA + integraciones externas)

@app.route('/api/composio/email', methods=['POST'])
def composio_email():
    """Envía un email a un cliente via Gmail usando el agente Composio."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Se requieren datos JSON."}), 400

    nombre = data.get('nombre', '')
    email = data.get('email', '')
    asunto = data.get('asunto', '')
    mensaje = data.get('mensaje', '')

    if not nombre or not email or not asunto or not mensaje:
        return jsonify({"error": "Campos requeridos: nombre, email, asunto, mensaje."}), 400

    try:
        resultado = composio_agent.enviar_email_cliente(nombre, email, asunto, mensaje)
        return jsonify({"status": "ok", "resultado": resultado}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/composio/sheets', methods=['POST'])
def composio_sheets():
    """Exporta todos los clientes a Google Sheets usando el agente Composio."""
    data = request.get_json() or {}
    nombre_hoja = data.get('nombre_hoja', 'CRM Seguridad')

    try:
        clientes, _ = database.get_clientes(estado=None, page=1, per_page=100)
        resultado = composio_agent.exportar_clientes_sheets(clientes, nombre_hoja)
        return jsonify({"status": "ok", "resultado": resultado}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/composio/calendario', methods=['POST'])
def composio_calendario():
    """Agenda una cita con un cliente en Google Calendar."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Se requieren datos JSON."}), 400

    nombre = data.get('nombre', '')
    telefono = data.get('telefono', '')
    fecha_hora = data.get('fecha_hora', '')
    descripcion = data.get('descripcion', '')

    if not nombre or not fecha_hora:
        return jsonify({"error": "Campos requeridos: nombre, fecha_hora."}), 400

    try:
        resultado = composio_agent.agendar_cita(nombre, telefono, fecha_hora, descripcion)
        return jsonify({"status": "ok", "resultado": resultado}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/composio/consulta', methods=['POST'])
def composio_consulta():
    """Consulta libre al agente IA con acceso a Gmail, Sheets y Calendar."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Se requieren datos JSON."}), 400

    pregunta = data.get('pregunta', '')
    if not pregunta:
        return jsonify({"error": "El campo 'pregunta' es obligatorio."}), 400

    try:
        respuesta = composio_agent.consulta_libre(pregunta)
        return jsonify({"status": "ok", "respuesta": respuesta}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# 4. Configuración del Bot de Telegram
TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '7234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789')
bot = telebot.TeleBot(TOKEN)

@bot.message_handler(commands=['start'])
def send_welcome(message):
    """Ofrece el botón WebApp para arrancar el CRM."""
    markup = ReplyKeyboardMarkup(row_width=1, resize_keyboard=True)
    
    web_app_url = os.environ.get('WEBAPP_URL', 'http://localhost:5000')
    web_app = WebAppInfo(url=web_app_url)
    
    btn = KeyboardButton(text="🚀 Abrir CRM de Seguridad", web_app=web_app)
    markup.add(btn)
    
    text = (
        "👮‍♂️ *CRM Móvil - Seguimiento de Seguridad*\n\n"
        "Hola. Presiona el botón de abajo para interactuar con la tabla *base_rpmkt* "
        "y dar seguimiento en tiempo real."
    )
    bot.send_message(message.chat.id, text, parse_mode='Markdown', reply_markup=markup)

def run_telegram_bot():
    """Ejecuta el polling del bot en un hilo secundario."""
    if TOKEN == '7234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789':
        print("[Advertencia] Usando token de Telegram ficticio. Define 'TELEGRAM_BOT_TOKEN' en variables de entorno.")
        return
    try:
        print("Iniciando bot de Telegram...")
        bot.infinity_polling()
    except Exception as e:
        print(f"[Error en Bot] El bot no pudo arrancar: {e}")


# 5. Inicializar Aplicación
if __name__ == '__main__':
    bot_thread = threading.Thread(target=run_telegram_bot, daemon=True)
    bot_thread.start()
    
    print("Iniciando servidor Flask en http://localhost:5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)
