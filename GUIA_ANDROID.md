# Usar el CRM en tu celular Android (desde la calle)

El CRM se publica gratis en **PythonAnywhere** y se instala en el Android como una app.
Solo lo haces una vez (unos 15 minutos, mejor desde una PC).

## 1. Crear la cuenta
1. Entra a https://www.pythonanywhere.com y elige **Pricing & signup → Create a Beginner account** (gratis).
2. Tu usuario será parte de tu dirección: `https://TU_USUARIO.pythonanywhere.com`

## 2. Subir el proyecto
1. En el panel, abre **Consoles → Bash**.
2. Pega estos comandos (Enter después de cada uno):
   ```bash
   git clone -b claude/android-mobile-connection-8k3jsl https://github.com/sd942866377-hue/crm_proyecto1.git
   pip install --user -r crm_proyecto1/requirements.txt
   ```
   > Si tu repositorio es **privado**, GitHub te pedirá usuario y un *token* en lugar de contraseña
   > (GitHub → Settings → Developer settings → Personal access tokens).

## 3. Crear la Web App
1. Ve a la pestaña **Web → Add a new web app → Next**.
2. Elige **Manual configuration** (¡no "Flask"!) → **Python 3.10** o superior → Next.
3. En esa misma página, haz clic en el enlace del **WSGI configuration file**.
4. Borra todo su contenido y pega el de `pythonanywhere_wsgi.py` de este proyecto.
5. Cambia `TU_USUARIO` por tu usuario y `CAMBIA_ESTA_CONTRASEÑA` por una contraseña tuya. Guarda (**Save**).
6. Vuelve a la pestaña **Web**, activa **Force HTTPS** y pulsa el botón verde **Reload**.

## 4. Instalar en el Android
1. En el celular, abre **Chrome** y entra a `https://TU_USUARIO.pythonanywhere.com`
2. Escribe el usuario (`admin`) y tu contraseña. Chrome puede recordarlos.
3. Toca el menú **⋮ → Instalar app** (o **Agregar a pantalla principal**).
4. Listo: tendrás el ícono **CRM** en tu pantalla, funcionando con tus datos móviles.

## Importante
- **Cada 3 meses** entra a PythonAnywhere → pestaña **Web** → botón **Run until 3 months from today**,
  o la app gratuita se apaga (tus datos no se borran).
- Tus clientes quedan guardados en `crm_seguridad.db` dentro de PythonAnywhere.
  Para respaldo: pestaña **Files → crm_proyecto1 → crm_seguridad.db → descargar**.
- Para actualizar el código después de cambios: en la consola Bash ejecuta
  `cd crm_proyecto1 && git pull` y luego **Reload** en la pestaña Web.
- El bot de Telegram no funciona en el plan gratuito; el CRM web sí, completo.
