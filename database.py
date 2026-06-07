# database.py - Gestión de Base de Datos SQLite para CRM de Seguridad

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crm_seguridad.db')

def init_db():
    """Inicializa la base de datos y crea las tablas necesarias."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Habilitar claves foráneas
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    # Crear tabla de clientes
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        telefono TEXT NOT NULL UNIQUE,
        estado TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Crear tabla de historial de llamadas (con Clave Foránea a clientes)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS historial_llamadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        estado TEXT NOT NULL,
        observacion TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    conn.close()
    print("Base de datos SQLite inicializada exitosamente.")

def save_cliente(nombre, telefono, estado, observacion):
    """
    Guarda o actualiza un cliente.
    Si el teléfono ya existe, actualiza el nombre y estado,
    y agrega un nuevo registro en el historial de llamadas.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    try:
        # Buscar cliente existente por teléfono
        cursor.execute("SELECT id FROM clientes WHERE telefono = ?", (telefono,))
        row = cursor.fetchone()
        
        if row:
            cliente_id = row[0]
            # Actualizar nombre, estado y timestamp de actualización del cliente
            cursor.execute("""
            UPDATE clientes 
            SET nombre = ?, estado = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
            """, (nombre, estado, cliente_id))
        else:
            # Crear nuevo registro de cliente
            cursor.execute("""
            INSERT INTO clientes (nombre, telefono, estado) 
            VALUES (?, ?, ?)
            """, (nombre, telefono, estado))
            cliente_id = cursor.lastrowid
            
        # Insertar registro de historial de llamadas asociado
        cursor.execute("""
        INSERT INTO historial_llamadas (cliente_id, estado, observacion) 
        VALUES (?, ?, ?)
        """, (cliente_id, estado, observacion))
        
        conn.commit()
        return cliente_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_clientes(estado=None, page=1, per_page=10):
    """
    Retorna una lista de clientes filtrada por estado y paginada,
    junto con el total de registros encontrados.
    Incluye la última observación registrada.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    offset = (page - 1) * per_page
    
    # Consultas base
    query_data = "SELECT id, nombre, telefono, estado, created_at, updated_at FROM clientes"
    query_count = "SELECT COUNT(*) FROM clientes"
    params = []
    
    if estado:
        query_data += " WHERE estado = ?"
        query_count += " WHERE estado = ?"
        params.append(estado)
        
    # Ordenar por fecha de última actualización
    query_data += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    data_params = params + [per_page, offset]
    
    # Obtener conteo total para calcular la paginación
    cursor.execute(query_count, params)
    total_records = cursor.fetchone()[0]
    
    # Obtener los registros de la página
    cursor.execute(query_data, data_params)
    rows = cursor.fetchall()
    
    clientes_list = []
    for row in rows:
        cliente = dict(row)
        
        # Consultar la última observación del historial para este cliente
        cursor.execute("""
        SELECT observacion, created_at 
        FROM historial_llamadas 
        WHERE cliente_id = ? 
        ORDER BY created_at DESC LIMIT 1
        """, (cliente['id'],))
        hist_row = cursor.fetchone()
        
        cliente['observacion'] = hist_row['observacion'] if hist_row else ""
        cliente['ultima_llamada'] = hist_row['created_at'] if hist_row else ""
        clientes_list.append(cliente)
        
    conn.close()
    return clientes_list, total_records

if __name__ == '__main__':
    # Inicializar la base de datos si se corre directamente
    init_db()
