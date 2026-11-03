import os
import json
import uuid
import datetime
import socket
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import pandas as pd
import io

app = FastAPI(title="Padel & Tennis Match Master API", version="2.0.0")

# Enable CORS for cross-origin local access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

PLAYERS_FILE = os.path.join(DATA_DIR, "players.json")
MATCHES_FILE = os.path.join(DATA_DIR, "matches.json")
TOURNAMENTS_FILE = os.path.join(DATA_DIR, "tournaments.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

def read_json(path: str, default: Any = None) -> Any:
    if not os.path.exists(path):
        return default if default is not None else []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default if default is not None else []

def write_json(path: str, data: Any):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# --- DEFAULT SETTINGS ---
def get_settings():
    default_settings = {
        "google_sheet_url": "",
        "auto_sync_sheets": True,
        "default_match_type": "singles", # singles or doubles
        "default_sport": "padel",        # padel or tennis
        "default_sets_to_win": 2,        # best of 3
        "default_games_per_set": 6,
        "default_tiebreak_at": 6,
        "default_golden_point": False,   # Deuce standard by default
        "sound_enabled": True,
        "voice_lang": "id-ID",           # id-ID or en-US
        "court_name": "Lapangan Utama",
        "courts_list": ["Lapangan 1", "Lapangan 2"]
    }
    settings = read_json(SETTINGS_FILE, default_settings)
    # Merge defaults if missing
    for k, v in default_settings.items():
        if k not in settings:
            settings[k] = v
    return settings

COURTS_FILE = os.path.join(DATA_DIR, "courts.json")

# --- API ENDPOINTS ---

@app.get("/api/info")
def get_system_info():
    ip = get_local_ip()
    return {
        "status": "online",
        "local_ip": ip,
        "local_url": f"http://localhost:8000",
        "network_url": f"http://{ip}:8000",
        "version": "2.0.0"
    }

@app.get("/api/settings")
def api_get_settings():
    return get_settings()

@app.post("/api/settings")
def api_save_settings(data: Dict[str, Any]):
    current = get_settings()
    current.update(data)
    write_json(SETTINGS_FILE, current)
    return {"status": "success", "settings": current}

# --- PLAYERS ---
@app.get("/api/players")
def api_get_players():
    return read_json(PLAYERS_FILE, [])

@app.post("/api/players")
def api_create_player(player: Dict[str, Any]):
    players = read_json(PLAYERS_FILE, [])
    player_id = str(uuid.uuid4())[:8]
    new_player = {
        "id": player_id,
        "name": player.get("name", "Pemain Baru"),
        "nickname": player.get("nickname", ""),
        "photo_url": player.get("photo_url", ""),
        "handedness": player.get("handedness", "Kanan"), # Kanan / Kidal
        "level": player.get("level", "Intermediate"),    # Beginner, Intermediate, Advanced, Pro
        "notes": player.get("notes", ""),
        "slogan_text": player.get("slogan_text", ""),
        "slogan_audio_url": player.get("slogan_audio_url", ""),
        "matches_played": 0,
        "matches_won": 0,
        "matches_lost": 0,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    players.append(new_player)
    write_json(PLAYERS_FILE, players)
    return new_player

@app.put("/api/players/{player_id}")
def api_update_player(player_id: str, data: Dict[str, Any]):
    players = read_json(PLAYERS_FILE, [])
    for idx, p in enumerate(players):
        if p["id"] == player_id:
            for k, v in data.items():
                if k != "id":
                    p[k] = v
            players[idx] = p
            write_json(PLAYERS_FILE, players)
            return p
    raise HTTPException(status_code=404, detail="Player not found")

@app.delete("/api/players/{player_id}")
def api_delete_player(player_id: str):
    players = read_json(PLAYERS_FILE, [])
    players = [p for p in players if p["id"] != player_id]
    write_json(PLAYERS_FILE, players)
    return {"status": "deleted", "id": player_id}

@app.post("/api/upload-photo")
async def api_upload_photo(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        ext = ".jpg"
    filename = f"player_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(UPLOADS_DIR, filename)
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)
    return {"url": f"/uploads/{filename}", "filename": filename}

@app.post("/api/upload-audio")
async def api_upload_audio(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".webm", ".wav", ".mp3", ".ogg", ".m4a", ".aac"]:
        ext = ".webm"
    filename = f"slogan_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(UPLOADS_DIR, filename)
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)
    return {"url": f"/uploads/{filename}", "filename": filename}

# --- MULTI-COURT ACTIVE MATCH SYNC ---
@app.get("/api/courts")
def api_get_courts():
    default_courts = [
        {"id": "court_1", "name": "Lapangan 1", "active_match": None, "last_updated": None},
        {"id": "court_2", "name": "Lapangan 2", "active_match": None, "last_updated": None}
    ]
    return read_json(COURTS_FILE, default_courts)

@app.post("/api/courts/{court_id}")
def api_save_court_match(court_id: str, data: Dict[str, Any]):
    courts = api_get_courts()
    match_data = data.get("match") if "match" in data else data
    court_name = data.get("court_name", "")
    
    found = False
    for c in courts:
        if c["id"] == court_id:
            c["active_match"] = match_data
            if court_name:
                c["name"] = court_name
            c["last_updated"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            found = True
            break
    if not found:
        courts.append({
            "id": court_id,
            "name": court_name or f"Lapangan {court_id}",
            "active_match": match_data,
            "last_updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
    write_json(COURTS_FILE, courts)
    return {"status": "success", "court_id": court_id, "active_match": match_data}

@app.delete("/api/courts/{court_id}")
def api_clear_court_match(court_id: str):
    courts = api_get_courts()
    for c in courts:
        if c["id"] == court_id:
            c["active_match"] = None
            c["last_updated"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            break
    write_json(COURTS_FILE, courts)
    return {"status": "cleared", "court_id": court_id}

# --- MATCHES ---
@app.get("/api/matches")
def api_get_matches():
    return read_json(MATCHES_FILE, [])

@app.post("/api/matches")
async def api_save_match(match: Dict[str, Any]):
    matches = read_json(MATCHES_FILE, [])
    match_id = match.get("id") or str(uuid.uuid4())[:8]
    match["id"] = match_id
    if "date" not in match:
        match["date"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Update or append
    existing_idx = next((i for i, m in enumerate(matches) if m["id"] == match_id), None)
    if existing_idx is not None:
        matches[existing_idx] = match
    else:
        matches.insert(0, match) # newest first
    write_json(MATCHES_FILE, matches)

    # Update players statistics if match is finished
    if match.get("status") == "completed" and match.get("winner"):
        update_player_stats_from_match(match)

    # Auto sync to Google Sheets if configured
    settings = get_settings()
    sheet_synced = False
    sheet_msg = ""
    if settings.get("auto_sync_sheets") and settings.get("google_sheet_url"):
        try:
            res = await sync_to_google_sheet(settings["google_sheet_url"], {"type": "match", "data": match})
            sheet_synced = res.get("status") == "success"
            sheet_msg = res.get("message", "")
        except Exception as e:
            sheet_msg = str(e)

    return {
        "status": "success",
        "match": match,
        "sheet_synced": sheet_synced,
        "sheet_message": sheet_msg
    }

@app.delete("/api/matches/{match_id}")
def api_delete_match(match_id: str):
    matches = read_json(MATCHES_FILE, [])
    matches = [m for m in matches if m["id"] != match_id]
    write_json(MATCHES_FILE, matches)
    return {"status": "deleted", "id": match_id}

def update_player_stats_from_match(match: Dict[str, Any]):
    players = read_json(PLAYERS_FILE, [])
    winner_team = match.get("winner") # "team_a" or "team_b"
    team_a_ids = match.get("team_a_player_ids", [])
    team_b_ids = match.get("team_b_player_ids", [])

    for p in players:
        pid = p["id"]
        if pid in team_a_ids:
            p["matches_played"] = p.get("matches_played", 0) + 1
            if winner_team == "team_a":
                p["matches_won"] = p.get("matches_won", 0) + 1
            else:
                p["matches_lost"] = p.get("matches_lost", 0) + 1
        elif pid in team_b_ids:
            p["matches_played"] = p.get("matches_played", 0) + 1
            if winner_team == "team_b":
                p["matches_won"] = p.get("matches_won", 0) + 1
            else:
                p["matches_lost"] = p.get("matches_lost", 0) + 1

    write_json(PLAYERS_FILE, players)

# --- TOURNAMENTS ---
@app.get("/api/tournaments")
def api_get_tournaments():
    return read_json(TOURNAMENTS_FILE, [])

@app.post("/api/tournaments")
async def api_create_tournament(tournament: Dict[str, Any]):
    tournaments = read_json(TOURNAMENTS_FILE, [])
    tourn_id = str(uuid.uuid4())[:8]
    tournament["id"] = tourn_id
    tournament["created_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    tournament["status"] = tournament.get("status", "active") # active, completed
    tournaments.insert(0, tournament)
    write_json(TOURNAMENTS_FILE, tournaments)

    # Optional sync to sheets
    settings = get_settings()
    if settings.get("auto_sync_sheets") and settings.get("google_sheet_url"):
        try:
            await sync_to_google_sheet(settings["google_sheet_url"], {"type": "tournament", "data": tournament})
        except Exception:
            pass

    return tournament

@app.put("/api/tournaments/{tourn_id}")
async def api_update_tournament(tourn_id: str, data: Dict[str, Any]):
    tournaments = read_json(TOURNAMENTS_FILE, [])
    for idx, t in enumerate(tournaments):
        if t["id"] == tourn_id:
            for k, v in data.items():
                if k != "id":
                    t[k] = v
            tournaments[idx] = t
            write_json(TOURNAMENTS_FILE, tournaments)

            # Sync update to Google Sheets if completed
            settings = get_settings()
            if settings.get("auto_sync_sheets") and settings.get("google_sheet_url"):
                try:
                    await sync_to_google_sheet(settings["google_sheet_url"], {"type": "tournament", "data": t})
                except Exception:
                    pass

            return t
    raise HTTPException(status_code=404, detail="Tournament not found")

@app.delete("/api/tournaments/{tourn_id}")
def api_delete_tournament(tourn_id: str):
    tournaments = read_json(TOURNAMENTS_FILE, [])
    tournaments = [t for t in tournaments if t["id"] != tourn_id]
    write_json(TOURNAMENTS_FILE, tournaments)
    return {"status": "deleted", "id": tourn_id}

# --- GOOGLE SHEETS SYNC ---
async def sync_to_google_sheet(webhook_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not webhook_url:
        return {"status": "error", "message": "URL Webhook Google Sheet belum diisi"}
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code in [200, 201, 302]:
                return {"status": "success", "message": "Berhasil sinkronisasi ke Google Sheet", "response": resp.text}
            else:
                return {"status": "error", "message": f"Server merespon dengan status {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"status": "error", "message": f"Gagal menghubungi Google Sheet: {str(e)}"}

@app.post("/api/sync-sheets")
async def api_manual_sync_sheets(data: Optional[Dict[str, Any]] = None):
    settings = get_settings()
    url = (data and data.get("google_sheet_url")) or settings.get("google_sheet_url")
    if not url:
        raise HTTPException(status_code=400, detail="URL Webhook Google Apps Script belum diatur.")
    
    matches = read_json(MATCHES_FILE, [])
    players = read_json(PLAYERS_FILE, [])
    tournaments = read_json(TOURNAMENTS_FILE, [])

    payload = {
        "type": "bulk_sync",
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "matches": matches,
        "players": players,
        "tournaments": tournaments
    }

    result = await sync_to_google_sheet(url, payload)
    return result

@app.post("/api/test-sheet-connection")
async def api_test_sheet_connection(data: Dict[str, Any]):
    url = data.get("google_sheet_url")
    if not url:
        raise HTTPException(status_code=400, detail="URL Google Sheet kosong.")
    
    test_payload = {
        "type": "ping",
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "message": "Tes koneksi dari Padel Tennis Match Master"
    }
    result = await sync_to_google_sheet(url, test_payload)
    return result

# --- EXPORT EXCEL & CSV ---
@app.get("/api/export/excel")
def export_excel():
    matches = read_json(MATCHES_FILE, [])
    players = read_json(PLAYERS_FILE, [])
    tournaments = read_json(TOURNAMENTS_FILE, [])

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        # Sheet 1: Matches
        matches_flat = []
        for m in matches:
            score_str = " - ".join([f"{s.get('team_a', 0)}:{s.get('team_b', 0)}" for s in m.get("sets_history", [])])
            mode_label = "Ganda (Doubles 2v2)" if m.get("mode") == "doubles" else "Tunggal (Singles 1v1)"
            games_count = m.get('rules', {}).get('games_per_set', 6)
            matches_flat.append({
                "ID Pertandingan": m.get("id"),
                "Tanggal": m.get("date"),
                "Nama Pertandingan": m.get("name", "Match"),
                "Olahraga": m.get("sport", "Padel"),
                "Kategori": mode_label,
                "Tim A": m.get("team_a_name", ""),
                "Tim B": m.get("team_b_name", ""),
                "Skor Akhir (Sets)": score_str,
                "Pemenang": m.get("team_a_name") if m.get("winner") == "team_a" else m.get("team_b_name"),
                "Status Menang": m.get("win_reason", "Selesai Normal"),
                "Format Set": f"Best of {m.get('rules', {}).get('sets_to_win', 2)*2-1} ({games_count} Games)",
                "Aturan Poin": "Golden Point (No-Ad)" if m.get("rules", {}).get("golden_point") else "Deuce / Advantage",
                "Durasi (Menit)": m.get("duration_minutes", 0),
                "Turnamen": m.get("tournament_name", "-")
            })
        df_matches = pd.DataFrame(matches_flat)
        df_matches.to_excel(writer, sheet_name="Pertandingan", index=False)

        # Sheet 2: Players
        players_flat = []
        for p in players:
            played = p.get("matches_played", 0)
            won = p.get("matches_won", 0)
            rate = round((won / played * 100), 1) if played > 0 else 0
            players_flat.append({
                "ID Pemain": p.get("id"),
                "Nama": p.get("name"),
                "Panggilan": p.get("nickname", "-"),
                "Tangan Dominan": p.get("handedness", "Kanan"),
                "Level": p.get("level", "Intermediate"),
                "Main": played,
                "Menang": won,
                "Kalah": p.get("matches_lost", 0),
                "Win Rate (%)": rate,
                "Slogan Juara": p.get("slogan_text", "-"),
                "Terdaftar": p.get("created_at", "-")
            })
        df_players = pd.DataFrame(players_flat)
        df_players.to_excel(writer, sheet_name="Pemain", index=False)

        # Sheet 3: Tournaments
        tourn_flat = []
        for t in tournaments:
            tourn_flat.append({
                "ID Turnamen": t.get("id"),
                "Nama Turnamen": t.get("name"),
                "Format": t.get("format", "Knockout"),
                "Status": t.get("status", "Active"),
                "Jumlah Peserta": len(t.get("participants", [])),
                "Juara": t.get("champion_name", "-"),
                "Tanggal Dibuat": t.get("created_at")
            })
        df_tourn = pd.DataFrame(tourn_flat)
        df_tourn.to_excel(writer, sheet_name="Turnamen", index=False)

    output.seek(0)
    filename = f"Padel_Tennis_Export_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/export/csv")
def export_csv():
    matches = read_json(MATCHES_FILE, [])
    matches_flat = []
    for m in matches:
        score_str = " - ".join([f"{s.get('team_a', 0)}:{s.get('team_b', 0)}" for s in m.get("sets_history", [])])
        matches_flat.append({
            "ID": m.get("id"),
            "Tanggal": m.get("date"),
            "Pertandingan": m.get("name", "Match"),
            "Olahraga": m.get("sport", "Padel"),
            "Tim A": m.get("team_a_name", ""),
            "Tim B": m.get("team_b_name", ""),
            "Skor": score_str,
            "Pemenang": m.get("team_a_name") if m.get("winner") == "team_a" else m.get("team_b_name")
        })
    df = pd.DataFrame(matches_flat)
    output = io.StringIO()
    df.to_csv(output, index=False)
    output.seek(0)
    filename = f"Matches_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# Mount uploads & static files
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    ip = get_local_ip()
    print("=================================================================")
    print("🎾 PADEL & TENNIS SCORING & TOURNAMENT MASTER")
    print(f"👉 Buka di Komputer: http://localhost:8000")
    print(f"👉 Buka di HP / Tablet Lapangan: http://{ip}:8000")
    print("=================================================================")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
