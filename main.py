# main.py - Servidor Web API Flask y Bot de Telegram

import os
import math
import threading
from flask import Flask, request, jsonify, send_from_directory
import telebot
from telebot.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

# Importar helper de base de datos
import database

# 1. Inicializar la base de datos SQLite
database.init_db()

# 2. Configuración de Flask
# Servimos los archivos estáticos desde el directorio actual (.)
app = Flask(__name__, static_folder='.', static_url_path='')

@app.route('/')
def index():
    """Ruta raíz que sirve el frontend de la WebApp."""
    return send_from_directory('.', 'index.html')

@app.route('/api/clientes', methods=['POST'])
def registrar_cliente():
    """Endpoint para registrar o actualizar un cliente."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No se recibieron datos JSON válidos."}), 400
        
    nombre = data.get('nombre')
    telefono = data.get('telefono')
    estado = data.get('estado')
    observacion = data.get('observacion', '')
    
    if not nombre or not telefono or not estado:
        return jsonify({"error": "Los campos 'nombre', 'telefono' y 'estado' son requeridos."}), 400
        
    try:
        database.save_cliente(nombre, telefono, estado, observacion)
        return jsonify({"status": "ok", "message": "Registro de cliente guardado exitosamente."}), 200
    except Exception as e:
        print(f"Error al registrar cliente en SQLite: {e}")
        return jsonify({"error": f"Error interno del servidor: {str(e)}"}), 500

@app.route('/api/clientes', methods=['GET'])
def listar_clientes():
    """Endpoint para retornar clientes filtrados y paginados."""
    estado = request.args.get('estado', '')
    try:
        page = int(request.args.get('page', 1))
    except ValueError:
        page = 1
        
    per_page = 10
    
    # Filtro vacío se considera 'Todos'
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
        print(f"Error al consultar clientes: {e}")
        return jsonify({"error": f"Error interno al realizar la consulta: {str(e)}"}), 500


# 3. Configuración del Bot de Telegram
# Si no se define token en variables de entorno, se utiliza un token ficticio para no crashear
TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '7234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789')
bot = telebot.TeleBot(TOKEN)

@bot.message_handler(commands=['start'])
def send_welcome(message):
    """Manejador del comando /start que ofrece el botón para abrir la WebApp."""
    markup = ReplyKeyboardMarkup(row_width=1, resize_keyboard=True)
    
    # URL de la WebApp: se lee de variables de entorno, o por defecto se usa localhost
    web_app_url = os.environ.get('WEBAPP_URL', 'http://localhost:5000')
    web_app = WebAppInfo(url=web_app_url)
    
    btn = KeyboardButton(text="🚀 Abrir CRM de Seguridad", web_app=web_app)
    markup.add(btn)
    
    text = (
        "👮‍♂️ *CRM Móvil - Asesores de Seguridad*\n\n"
        "Hola. Presiona el botón de abajo para registrar llamadas de clientes, "
        "dar seguimiento a cotizaciones o consultar el historial dinámico."
    )
    bot.send_message(message.chat.id, text, parse_mode='Markdown', reply_markup=markup)

def run_telegram_bot():
    """Función para arrancar el bot en un hilo separado."""
    if TOKEN == '7234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789':
        print("[Advertencia] Usando token de Telegram ficticio. Define la variable de entorno 'TELEGRAM_BOT_TOKEN' para activar el bot real.")
        return
        
    try:
        print("Iniciando bot de Telegram (infinity polling)...")
        bot.infinity_polling()
    except Exception as e:
        print(f"[Error en Bot] El bot de Telegram no pudo arrancar: {e}")


# 4. Inicializar Aplicación
if __name__ == '__main__':
    # Lanzar el bot en un hilo secundario para evitar bloquear el servidor Flask
    bot_thread = threading.Thread(target=run_telegram_bot, daemon=True)
    bot_thread.start()
    
    # Arrancar Flask (escuchando en puerto 5000)
    print("Iniciando servidor Flask en http://localhost:5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)
