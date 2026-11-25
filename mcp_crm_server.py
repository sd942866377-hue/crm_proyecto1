"""
Conector MCP personalizado para CRM Seguridad
Agrégalo en Claude app > Conectores personalizados
"""

import subprocess
import json
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("CRM Seguridad")

AGENT_REACH_BIN = "agent-reach"
CHANNELS = ["web", "github", "youtube", "v2ex"]


@mcp.tool()
def buscar_web(consulta: str) -> str:
    """Busca información en la web usando Agent-Reach."""
    return _buscar("web", consulta)


@mcp.tool()
def buscar_github(consulta: str) -> str:
    """Busca repositorios y código en GitHub."""
    return _buscar("github", consulta)


@mcp.tool()
def buscar_youtube(consulta: str) -> str:
    """Busca videos en YouTube."""
    return _buscar("youtube", consulta)


@mcp.tool()
def canales_disponibles() -> str:
    """Lista los canales de búsqueda disponibles."""
    return json.dumps({"canales": CHANNELS})


def _buscar(canal: str, consulta: str) -> str:
    try:
        result = subprocess.run(
            [AGENT_REACH_BIN, canal, "search", consulta],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip() or result.stderr.strip()
    except FileNotFoundError:
        return json.dumps({"error": "agent-reach no instalado. Ejecuta: pip install agent-reach"})
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Tiempo agotado (30s)"})
    except Exception as e:
        return json.dumps({"error": str(e)})


if __name__ == "__main__":
    mcp.run()
