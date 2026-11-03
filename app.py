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

app = FastAPI(title="DF Scoring PRO API", version="3.0.0")

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
COURTS_FILE = os.path.join(DATA_DIR, "courts.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")

ADMIN_PASSWORDS = {"12345678910", "1234567890"}

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

def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def get_settings():
    default_settings = {
        "google_sheet_url": "",
        "google_client_id": "",
        "auto_sync_sheets": True,
        "default_match_type": "doubles",
        "default_sport": "padel",
        "default_sets_to_win": 2,
        "default_games_per_set": 6,
        "default_tiebreak_at": 6,
        "default_golden_point": False,
        "sound_enabled": True,
        "voice_lang": "id-ID",
        "court_name": "Lapangan Utama",
        "courts_list": ["Lapangan 1", "Lapangan 2", "Lapangan 3"]
    }
    settings = read_json(SETTINGS_FILE, default_settings)
    for k, v in default_settings.items():
        if k not in settings:
            settings[k] = v
    return settings

def get_courts_list():
    default_courts = [
        {"id": "court_1", "name": "Lapangan 1 (HP 1)", "active_match": None, "last_updated": None},
        {"id": "court_2", "name": "Lapangan 2 (HP 2)", "active_match": None, "last_updated": None},
        {"id": "court_3", "name": "Lapangan 3", "active_match": None, "last_updated": None}
    ]
    return read_json(COURTS_FILE, default_courts)

def recalculate_all_player_stats():
    players = read_json(PLAYERS_FILE, [])
    matches = read_json(MATCHES_FILE, [])

    for p in players:
        p["matches_played"] = 0
        p["matches_won"] = 0
        p["matches_lost"] = 0
        p["sets_won"] = 0
        p["sets_lost"] = 0
        p["games_won"] = 0
        p["games_lost"] = 0

    for m in matches:
        if m.get("status") != "completed" or not m.get("winner"):
            continue
        winner = m.get("winner")
        team_a_ids = list(m.get("team_a_player_ids") or []) + [x.get("id") for x in (m.get("team_a_players") or []) if isinstance(x, dict) and x.get("id")]
        team_b_ids = list(m.get("team_b_player_ids") or []) + [x.get("id") for x in (m.get("team_b_players") or []) if isinstance(x, dict) and x.get("id")]
        team_a_names = [x.get("name", "").lower() for x in (m.get("team_a_players") or []) if isinstance(x, dict) and x.get("name")]
        team_b_names = [x.get("name", "").lower() for x in (m.get("team_b_players") or []) if isinstance(x, dict) and x.get("name")]

        sets_a, sets_b, games_a, games_b = 0, 0, 0, 0
        for s in (m.get("sets_history") or []):
            try:
                ga = int(s.get("team_a"))
                gb = int(s.get("team_b"))
                games_a += ga
                games_b += gb
                if ga > gb:
                    sets_a += 1
                elif gb > ga:
                    sets_b += 1
            except Exception:
                if s.get("winner") == "team_a":
                    sets_a += 1
                elif s.get("winner") == "team_b":
                    sets_b += 1

        for p in players:
            pid = p.get("id")
            pname = (p.get("name") or "").lower()
            in_a = pid in team_a_ids or pname in team_a_names or pname == (m.get("team_a_name") or "").lower()
            in_b = pid in team_b_ids or pname in team_b_names or pname == (m.get("team_b_name") or "").lower()

            if in_a:
                p["matches_played"] += 1
                if winner == "team_a":
                    p["matches_won"] += 1
                else:
                    p["matches_lost"] += 1
                p["sets_won"] += sets_a
                p["sets_lost"] += sets_b
                p["games_won"] += games_a
                p["games_lost"] += games_b
            elif in_b:
                p["matches_played"] += 1
                if winner == "team_b":
                    p["matches_won"] += 1
                else:
                    p["matches_lost"] += 1
                p["sets_won"] += sets_b
                p["sets_lost"] += sets_a
                p["games_won"] += games_b
                p["games_lost"] += games_a

    write_json(PLAYERS_FILE, players)
    return players

# --- API ENDPOINTS ---

@app.get("/api/bootstrap")
def api_bootstrap():
    ip = get_local_ip()
    return {
        "info": {
            "status": "online",
            "app_name": "DF Scoring PRO",
            "local_ip": ip,
            "local_url": "http://localhost:8000",
            "network_url": f"http://{ip}:8000",
            "version": "3.0.0"
        },
        "settings": get_settings(),
        "players": read_json(PLAYERS_FILE, []),
        "tournaments": read_json(TOURNAMENTS_FILE, []),
        "matches": read_json(MATCHES_FILE, []),
        "courts": get_courts_list(),
        "users": read_json(USERS_FILE, [])
    }

@app.get("/api/info")
def get_system_info():
    ip = get_local_ip()
    return {
        "status": "online",
        "app_name": "DF Scoring PRO",
        "local_ip": ip,
        "local_url": "http://localhost:8000",
        "network_url": f"http://{ip}:8000",
        "version": "3.0.0"
    }

@app.post("/api/auth/login")
def api_auth_login(body: Dict[str, Any]):
    role = "admin" if body.get("role") == "admin" else "member"
    if role == "admin":
        pwd = str(body.get("password") or "").strip()
        if pwd not in ADMIN_PASSWORDS:
            return JSONResponse(
                status_code=401,
                content={
                    "status": "error",
                    "message": "Password Admin salah!"
                }
            )

    users = read_json(USERS_FILE, [])
    short_id = str(uuid.uuid4())[:8]
    email = (body.get("email") or ("admin@dfscoring.pro" if role == "admin" else f"member_{short_id}@gmail.com")).lower()
    name = body.get("name") or ("Super Admin DF" if role == "admin" else "Member DF")
    picture = body.get("picture") or f"https://api.dicebear.com/7.x/bottts/svg?seed={name}"

    user_rec = next((u for u in users if u.get("email") == email and u.get("role") == role), None)
    if user_rec:
        user_rec["name"] = name
        if body.get("picture"):
            user_rec["picture"] = body["picture"]
        user_rec["last_login"] = now_str()
        user_rec["login_count"] = (user_rec.get("login_count") or 1) + 1
        user_rec["court_id"] = body.get("court_id") or user_rec.get("court_id") or "court_1"
    else:
        user_rec = {
            "id": f"u_{short_id}",
            "name": name,
            "email": email,
            "picture": picture,
            "role": role,
            "provider": body.get("provider") or ("admin_password" if role == "admin" else "google"),
            "player_id": body.get("player_id"),
            "court_id": body.get("court_id") or "court_1",
            "login_count": 1,
            "created_at": now_str(),
            "last_login": now_str()
        }
        users.insert(0, user_rec)

    write_json(USERS_FILE, users)
    return {"status": "success", "user": user_rec}

@app.get("/api/users")
def api_get_users():
    return read_json(USERS_FILE, [])

@app.delete("/api/users/{user_id}")
def api_delete_user(user_id: str):
    users = read_json(USERS_FILE, [])
    users = [u for u in users if u.get("id") != user_id]
    write_json(USERS_FILE, users)
    return {"status": "deleted", "id": user_id}

@app.post("/api/admin/recalculate-stats")
def api_admin_recalculate():
    updated = recalculate_all_player_stats()
    return {"status": "success", "players": updated}

@app.get("/api/admin/backup")
def api_admin_backup():
    return {
        "backup_version": "3.0",
        "exported_at": now_str(),
        "settings": get_settings(),
        "players": read_json(PLAYERS_FILE, []),
        "tournaments": read_json(TOURNAMENTS_FILE, []),
        "matches": read_json(MATCHES_FILE, []),
        "courts": get_courts_list(),
        "users": read_json(USERS_FILE, [])
    }

@app.post("/api/admin/restore")
def api_admin_restore(data: Dict[str, Any]):
    if isinstance(data.get("players"), list):
        write_json(PLAYERS_FILE, data["players"])
    if isinstance(data.get("matches"), list):
        write_json(MATCHES_FILE, data["matches"])
    if isinstance(data.get("tournaments"), list):
        write_json(TOURNAMENTS_FILE, data["tournaments"])
    if isinstance(data.get("courts"), list):
        write_json(COURTS_FILE, data["courts"])
    if isinstance(data.get("users"), list):
        write_json(USERS_FILE, data["users"])
    if isinstance(data.get("settings"), dict):
        cur = get_settings()
        cur.update(data["settings"])
        write_json(SETTINGS_FILE, cur)
    return {"status": "success", "message": "Database berhasil dipulihkan!"}

@app.get("/api/settings")
def api_get_settings():
    return get_settings()

@app.post("/api/settings")
def api_save_settings(data: Dict[str, Any]):
    current = get_settings()
    current.update(data)
    write_json(SETTINGS_FILE, current)
    return current

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
        "handedness": player.get("handedness", "Kanan"),
        "level": player.get("level", "Intermediate"),
        "notes": player.get("notes", ""),
        "slogan_text": player.get("slogan_text", ""),
        "slogan_audio_url": player.get("slogan_audio_url", ""),
        "matches_played": 0,
        "matches_won": 0,
        "matches_lost": 0,
        "sets_won": 0,
        "sets_lost": 0,
        "games_won": 0,
        "games_lost": 0,
        "created_at": now_str()
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
    return get_courts_list()

@app.post("/api/courts/{court_id}")
def api_save_court_match(court_id: str, data: Dict[str, Any]):
    courts = get_courts_list()
    match_data = data.get("match") if "match" in data else data
    court_name = data.get("court_name", "")

    found = False
    for c in courts:
        if c["id"] == court_id:
            old_match = c.get("active_match") or {}
            old_ver = old_match.get("version") or 0
            new_ver = (match_data or {}).get("version") or 0
            if old_match and match_data and old_match.get("id") == match_data.get("id") and new_ver < old_ver:
                return {"status": "ignored_stale", "court_id": court_id, "active_match": old_match}
            c["active_match"] = match_data
            if court_name:
                c["name"] = court_name
            c["last_updated"] = now_str()
            found = True
            break
    if not found:
        courts.append({
            "id": court_id,
            "name": court_name or f"Lapangan {court_id}",
            "active_match": match_data,
            "last_updated": now_str()
        })
    write_json(COURTS_FILE, courts)
    return {"status": "success", "court_id": court_id, "active_match": match_data}

@app.delete("/api/courts/{court_id}")
def api_clear_court_match(court_id: str):
    courts = get_courts_list()
    for c in courts:
        if c["id"] == court_id:
            c["active_match"] = None
            c["last_updated"] = now_str()
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
        match["date"] = now_str()

    existing_idx = next((i for i, m in enumerate(matches) if m["id"] == match_id), None)
    if existing_idx is not None:
        matches[existing_idx] = match
    else:
        matches.insert(0, match)
    write_json(MATCHES_FILE, matches)

    if match.get("status") == "completed" and match.get("winner"):
        recalculate_all_player_stats()

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

@app.put("/api/matches/{match_id}")
def api_update_match(match_id: str, data: Dict[str, Any]):
    matches = read_json(MATCHES_FILE, [])
    for idx, m in enumerate(matches):
        if m.get("id") == match_id:
            m.update(data)
            m["id"] = match_id
            matches[idx] = m
            write_json(MATCHES_FILE, matches)
            recalculate_all_player_stats()
            return {"status": "updated", "match": m}
    raise HTTPException(status_code=404, detail="Match not found")

@app.delete("/api/matches/{match_id}")
def api_delete_match(match_id: str):
    matches = read_json(MATCHES_FILE, [])
    matches = [m for m in matches if m["id"] != match_id]
    write_json(MATCHES_FILE, matches)
    recalculate_all_player_stats()
    return {"status": "deleted", "id": match_id}

# --- TOURNAMENTS ---
@app.get("/api/tournaments")
def api_get_tournaments():
    return read_json(TOURNAMENTS_FILE, [])

@app.post("/api/tournaments")
async def api_create_tournament(tournament: Dict[str, Any]):
    tournaments = read_json(TOURNAMENTS_FILE, [])
    tourn_id = tournament.get("id") or str(uuid.uuid4())[:8]
    tournament["id"] = tourn_id
    tournament["created_at"] = tournament.get("created_at") or now_str()
    tournament["status"] = tournament.get("status", "active")
    tournaments.insert(0, tournament)
    write_json(TOURNAMENTS_FILE, tournaments)

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
        "timestamp": now_str(),
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
        "timestamp": now_str(),
        "message": "Tes koneksi dari DF Scoring PRO"
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
                "Lapangan": m.get("court_id", "court_1"),
                "Dicatat Oleh": (m.get("scored_by") or {}).get("name", "-"),
                "Durasi (Menit)": m.get("duration_minutes", 0),
                "Turnamen": m.get("tournament_name", "-")
            })
        df_matches = pd.DataFrame(matches_flat)
        df_matches.to_excel(writer, sheet_name="Pertandingan", index=False)

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
    filename = f"DF_Scoring_Export_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
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

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    ip = get_local_ip()
    print("=================================================================")
    print("🎾 DF SCORING PRO — PADEL & TENNIS SCORING & TOURNAMENT MASTER")
    print(f"👉 Buka di Komputer: http://localhost:8000")
    print(f"👉 Buka di HP / Tablet Lapangan: http://{ip}:8000")
    print("=================================================================")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
