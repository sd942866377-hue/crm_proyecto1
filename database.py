# database.py - Gestión de SQLite con la tabla base_rpmkt para CRM de Seguridad

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crm_seguridad.db')

def init_db():
    """Inicializa la base de datos y crea la tabla base_rpmkt."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Crear la tabla base_rpmkt con las 14 columnas requeridas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS base_rpmkt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedencia TEXT,
        estado TEXT,
        cliente TEXT NOT NULL,
        telefono TEXT NOT NULL UNIQUE,
        fecha TEXT,
        hora TEXT,
        distrito TEXT,
        direccion TEXT,
        archivo_origen TEXT DEFAULT 'BASE_RPMKT_2.xlsx',
        contacto_observacion TEXT DEFAULT CURRENT_TIMESTAMP,
        observacion TEXT,
        estado_seguimiento TEXT,
        historial_contactos TEXT,
        accion_contacto TEXT
    );
    """)
    
    conn.commit()
    conn.close()
    print("Base de datos SQLite inicializada con la tabla 'base_rpmkt'.")

def save_cliente(procedencia, estado, cliente, telefono, fecha, hora, distrito, 
                 direccion, archivo_origen, contacto_observacion, observacion, 
                 estado_seguimiento, historial_contactos, accion_contacto):
    """
    Guarda o actualiza un registro en la tabla base_rpmkt.
    Si el teléfono ya existe, realiza una actualización (UPSERT manual).
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Asignar valores por defecto si vienen vacíos
    if not archivo_origen:
        archivo_origen = 'BASE_RPMKT_2.xlsx'
    if not contacto_observacion:
        contacto_observacion = 'now()' # Valor predeterminado según especificación
        
    try:
        # Buscar registro existente por teléfono
        cursor.execute("SELECT id FROM base_rpmkt WHERE telefono = ?", (telefono,))
        row = cursor.fetchone()
        
        if row:
            # Actualizar registro existente
            cursor.execute("""
            UPDATE base_rpmkt 
            SET procedencia = ?, estado = ?, cliente = ?, fecha = ?, hora = ?, 
                distrito = ?, direccion = ?, archivo_origen = ?, contacto_observacion = ?, 
                observacion = ?, estado_seguimiento = ?, historial_contactos = ?, accion_contacto = ?
            WHERE id = ?
            """, (procedencia, estado, cliente, fecha, hora, distrito, direccion, 
                  archivo_origen, contacto_observacion, observacion, estado_seguimiento, 
                  historial_contactos, accion_contacto, row[0]))
            registro_id = row[0]
        else:
            # Crear nuevo registro
            cursor.execute("""
            INSERT INTO base_rpmkt (
                procedencia, estado, cliente, telefono, fecha, hora, distrito, 
                direccion, archivo_origen, contacto_observacion, observacion, 
                estado_seguimiento, historial_contactos, accion_contacto
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (procedencia, estado, cliente, telefono, fecha, hora, distrito, 
                  direccion, archivo_origen, contacto_observacion, observacion, 
                  estado_seguimiento, historial_contactos, accion_contacto))
            registro_id = cursor.lastrowid
            
        conn.commit()
        return registro_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_clientes(estado=None, page=1, per_page=10):
    """
    Retorna la lista de registros de la tabla base_rpmkt
    filtrada opcionalmente por estado y paginada de 10 en 10.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    offset = (page - 1) * per_page
    
    # Consultas base
    query_data = "SELECT * FROM base_rpmkt"
    query_count = "SELECT COUNT(*) FROM base_rpmkt"
    params = []
    
    if estado:
        query_data += " WHERE estado = ?"
        query_count += " WHERE estado = ?"
        params.append(estado)
        
    # Ordenar por id descendente (los más recientes primero)
    query_data += " ORDER BY id DESC LIMIT ? OFFSET ?"
    data_params = params + [per_page, offset]
    
    # Obtener conteo total
    cursor.execute(query_count, params)
    total_records = cursor.fetchone()[0]
    
    # Obtener los datos
    cursor.execute(query_data, data_params)
    rows = cursor.fetchall()
    
    clientes_list = [dict(row) for row in rows]
    
    conn.close()
    return clientes_list, total_records

if __name__ == '__main__':
    init_db()
