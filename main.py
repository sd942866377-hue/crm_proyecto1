# main.py - Servidor Web API Flask y Bot de Telegram para base_rpmkt

import os
import math
import threading
from flask import Flask, request, jsonify, send_from_directory
import telebot
from telebot.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

# Importar helper de base de datos
import database

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


# 3. Configuración del Bot de Telegram
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


# 4. Inicializar Aplicación
if __name__ == '__main__':
    bot_thread = threading.Thread(target=run_telegram_bot, daemon=True)
    bot_thread.start()
    
    print("Iniciando servidor Flask en http://localhost:5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)
