# composio_agent.py - Agente IA con herramientas Composio para el CRM de Seguridad

import os
from dotenv import load_dotenv
import anthropic
from composio import Composio
from composio_anthropic import AnthropicProvider

load_dotenv()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
COMPOSIO_API_KEY = os.environ.get("COMPOSIO_API_KEY", "")

SYSTEM_PROMPT = """Eres un asistente CRM especializado en seguridad para la empresa.
Tienes acceso a herramientas de Gmail, Google Sheets y Google Calendar mediante Composio.

Tus capacidades:
- Enviar correos de seguimiento a clientes vía Gmail
- Exportar datos de clientes a Google Sheets
- Agendar citas y reuniones en Google Calendar

Responde siempre en español. Sé conciso y profesional.
Cuando ejecutes una acción, confirma el resultado claramente."""

DEFAULT_USER = "default"


def _build_sdk() -> tuple[Composio, anthropic.Anthropic]:
    """Inicializa el SDK de Composio y el cliente de Anthropic."""
    if not ANTHROPIC_API_KEY:
        raise ValueError("Falta ANTHROPIC_API_KEY en las variables de entorno.")
    if not COMPOSIO_API_KEY:
        raise ValueError("Falta COMPOSIO_API_KEY en las variables de entorno.")
    sdk = Composio(api_key=COMPOSIO_API_KEY, provider=AnthropicProvider())
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return sdk, client


def _run_agent_loop(prompt: str, toolkits: list[str]) -> str:
    """Ejecuta el loop agentico de Claude con las herramientas Composio indicadas."""
    sdk, client = _build_sdk()
    tools = sdk.tools.get(user_id=DEFAULT_USER, toolkits=toolkits)
    messages = [{"role": "user", "content": prompt}]

    for _ in range(10):
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return "Acción completada."

        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            tool_results = sdk.provider.handle_tool_calls(
                user_id=DEFAULT_USER, response=response
            )
            tool_content = [
                {
                    "type": "tool_result",
                    "tool_use_id": r.tool_call_id,
                    "content": str(r.data),
                }
                for r in tool_results
            ]
            messages.append({"role": "user", "content": tool_content})
        else:
            break

    return "El agente no pudo completar la tarea."


def enviar_email_cliente(nombre: str, email: str, asunto: str, mensaje: str) -> str:
    """Envía un correo a un cliente usando Gmail vía Composio."""
    prompt = (
        f"Envía un email al cliente '{nombre}' "
        f"a la dirección {email}. "
        f"Asunto: {asunto}. "
        f"Mensaje: {mensaje}"
    )
    return _run_agent_loop(prompt, toolkits=["gmail"])


def exportar_clientes_sheets(clientes: list[dict], nombre_hoja: str = "CRM Seguridad") -> str:
    """Exporta la lista de clientes a una hoja de Google Sheets."""
    campos = ["id", "cliente", "telefono", "estado", "distrito", "estado_seguimiento"]
    filas = [[str(c.get(campo, "")) for campo in campos] for c in clientes[:50]]
    prompt = (
        f"Crea o actualiza una hoja de Google Sheets llamada '{nombre_hoja}'. "
        f"Agrega los encabezados: {campos}. "
        f"Luego inserta estas filas de clientes del CRM: {filas}"
    )
    return _run_agent_loop(prompt, toolkits=["googlesheets"])


def agendar_cita(nombre_cliente: str, telefono: str, fecha_hora: str, descripcion: str) -> str:
    """Agenda una cita con un cliente en Google Calendar."""
    prompt = (
        f"Crea un evento en Google Calendar para una cita con el cliente '{nombre_cliente}' "
        f"(teléfono: {telefono}). "
        f"Fecha y hora: {fecha_hora}. "
        f"Descripción: {descripcion}"
    )
    return _run_agent_loop(prompt, toolkits=["googlecalendar"])


def consulta_libre(pregunta: str) -> str:
    """Permite consultas libres al agente con acceso a Gmail, Sheets y Calendar."""
    return _run_agent_loop(pregunta, toolkits=["gmail", "googlesheets", "googlecalendar"])
