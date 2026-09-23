# pythonanywhere_wsgi.py - Copia este contenido en el archivo WSGI de tu Web App en PythonAnywhere
# (pestaña "Web" -> "WSGI configuration file"). Cambia TU_USUARIO y la contraseña.

import os
import sys

# Carpeta donde clonaste el proyecto
path = '/home/TU_USUARIO/crm_proyecto1'
if path not in sys.path:
    sys.path.insert(0, path)

# Usuario y contraseña para entrar al CRM desde el celular
os.environ['CRM_USUARIO'] = 'admin'
os.environ['CRM_PASSWORD'] = 'CAMBIA_ESTA_CONTRASEÑA'

from main import app as application  # noqa: E402
