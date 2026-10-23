# football_api.py - Integración con API-FOOTBALL (api-sports.io)
# Documentación: https://www.api-football.com/documentation-v3
# Obtén tu API key gratis en: https://dashboard.api-football.com/register

import os
import requests

BASE_URL = "https://v3.football.api-sports.io"

def _headers():
    api_key = os.environ.get("API_FOOTBALL_KEY", "")
    return {
        "x-apisports-key": api_key,
        "x-rapidapi-host": "v3.football.api-sports.io"
    }

def _get(endpoint, params=None):
    try:
        r = requests.get(f"{BASE_URL}{endpoint}", headers=_headers(), params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        if data.get("errors"):
            return {"error": str(data["errors"])}
        return data
    except requests.exceptions.Timeout:
        return {"error": "Timeout al conectar con API-FOOTBALL"}
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}

def get_live_scores():
    """Partidos en vivo ahora mismo."""
    return _get("/fixtures", {"live": "all"})

def get_fixtures(league_id, season, next_n=10):
    """Próximos partidos de una liga."""
    return _get("/fixtures", {
        "league": league_id,
        "season": season,
        "next": next_n
    })

def get_standings(league_id, season):
    """Tabla de posiciones de una liga."""
    return _get("/standings", {"league": league_id, "season": season})

def get_predictions(fixture_id):
    """Predicciones de resultado para un partido (ideal para apuestas)."""
    return _get("/predictions", {"fixture": fixture_id})

def get_odds(fixture_id, bookmaker_id=None):
    """Cuotas/odds de un partido."""
    params = {"fixture": fixture_id}
    if bookmaker_id:
        params["bookmaker"] = bookmaker_id
    return _get("/odds", params)

def get_team_stats(team_id, league_id, season):
    """Estadísticas de un equipo en una liga/temporada."""
    return _get("/teams/statistics", {
        "team": team_id,
        "league": league_id,
        "season": season
    })

def get_top_scorers(league_id, season):
    """Máximos goleadores de una liga."""
    return _get("/players/topscorers", {"league": league_id, "season": season})

def search_team(name):
    """Buscar equipo por nombre."""
    return _get("/teams", {"search": name})

def get_leagues(country=None):
    """Listar ligas. Filtra por país si se indica."""
    params = {}
    if country:
        params["country"] = country
    return _get("/leagues", params)

def get_fixture_stats(fixture_id):
    """Estadísticas detalladas de un partido (posesión, tiros, etc.)."""
    return _get("/fixtures/statistics", {"fixture": fixture_id})

def get_head_to_head(team1_id, team2_id, last=5):
    """Historial de enfrentamientos entre dos equipos."""
    return _get("/fixtures/headtohead", {
        "h2h": f"{team1_id}-{team2_id}",
        "last": last
    })
