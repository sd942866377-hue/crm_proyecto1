"""
Búsqueda de incidentes de seguridad en TikTok via HasData API
Para prospección de zonas - Prosegur Lima
"""
import urllib.request
import urllib.parse
import json
import os

API_KEY = os.environ.get("HASDATA_API_KEY", "hd_5f0906f2863b4d90e6ca49d21f55125eab6c5aa7a30f7838")

TERMINOS_BUSQUEDA = [
    "robo Los Olivos Lima",
    "asalto Lima norte",
    "robo en vivo Lima",
    "inseguridad Los Olivos",
    "robo Independencia Lima",
    "asalto San Martin de Porres",
]


def buscar_tiktok(query: str) -> list:
    url = "https://api.hasdata.com/scrape/tiktok/search"
    params = urllib.parse.urlencode({
        "query": query,
        "type": "video",
        "count": 5
    })
    full_url = f"{url}?{params}"

    req = urllib.request.Request(
        full_url,
        headers={"x-api-key": API_KEY}
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}


def buscar_zonas_peligrosas():
    print("=" * 60)
    print("BÚSQUEDA DE ZONAS - PROSPECCIÓN PROSEGUR LIMA")
    print("=" * 60)

    for termino in TERMINOS_BUSQUEDA:
        print(f"\nBuscando: {termino}")
        resultado = buscar_tiktok(termino)

        if isinstance(resultado, dict) and "error" in resultado:
            print(f"  Error: {resultado['error']}")
            continue

        videos = resultado if isinstance(resultado, list) else resultado.get("data", resultado.get("videos", []))

        for video in videos[:3]:
            titulo = video.get("title") or video.get("desc", "Sin título")
            autor = video.get("author", {})
            nombre_autor = autor.get("nickname", "") if isinstance(autor, dict) else str(autor)
            likes = video.get("stats", {}).get("diggCount", video.get("diggCount", 0))
            url_video = video.get("url", video.get("shareUrl", ""))

            print(f"  - {titulo[:80]}")
            print(f"    Autor: @{nombre_autor} | Likes: {likes}")
            if url_video:
                print(f"    URL: {url_video}")

    print("\n" + "=" * 60)
    print("Búsqueda completada.")


if __name__ == "__main__":
    buscar_zonas_peligrosas()
