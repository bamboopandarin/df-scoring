/**
 * DF Scoring - Full Cloudflare Pages Functions Backend API
 * Replaces app.py & Google Apps Script for 100% Serverless Cloud Deployment on pages.dev
 * Supports Cloudflare KV (env.DF_SCORING_KV / env.PADEL_DB) + Cloudflare Edge Cache API fallback.
 */

const MEMORY_STORE = {
  players: null,
  matches: null,
  tournaments: null,
  courts: null,
  settings: null
};

const DEFAULT_PLAYERS = [
  {
    id: "p1",
    name: "Budi Santoso",
    nickname: "The Smasher",
    photo_url: "https://api.dicebear.com/7.x/bottts/svg?seed=Budi",
    handedness: "Kanan",
    level: "Advanced",
    notes: "Spesialis bola lob dan smash keras",
    slogan_text: "Smash keras pantang mundur!",
    slogan_audio_url: "",
    matches_played: 5,
    matches_won: 4,
    matches_lost: 1,
    created_at: "2025-02-01 10:00:00"
  },
  {
    id: "p2",
    name: "Rizky Pratama",
    nickname: "Fast Feet",
    photo_url: "https://api.dicebear.com/7.x/bottts/svg?seed=Rizky",
    handedness: "Kidal",
    level: "Intermediate",
    notes: "Sangat cepat di dekat net",
    slogan_text: "Kecepatan adalah kunci kemenangan!",
    slogan_audio_url: "",
    matches_played: 5,
    matches_won: 3,
    matches_lost: 2,
    created_at: "2025-02-01 10:05:00"
  },
  {
    id: "p3",
    name: "Aditya Wijaya",
    nickname: "Spin Doctor",
    photo_url: "https://api.dicebear.com/7.x/bottts/svg?seed=Aditya",
    handedness: "Kanan",
    level: "Advanced",
    notes: "Slice dan bandeja mematikan",
    slogan_text: "Satu spin seribu poin!",
    slogan_audio_url: "",
    matches_played: 4,
    matches_won: 2,
    matches_lost: 2,
    created_at: "2025-02-01 10:10:00"
  },
  {
    id: "p4",
    name: "Dimas Anggara",
    nickname: "The Wall",
    photo_url: "https://api.dicebear.com/7.x/bottts/svg?seed=Dimas",
    handedness: "Kanan",
    level: "Intermediate",
    notes: "Pertahanan rapat jarang mati sendiri",
    slogan_text: "Tembok pertahanan tak tertembus!",
    slogan_audio_url: "",
    matches_played: 4,
    matches_won: 1,
    matches_lost: 3,
    created_at: "2025-02-01 10:15:00"
  }
];

const DEFAULT_SETTINGS = {
  google_sheet_url: "",
  auto_sync_sheets: true,
  default_match_type: "doubles",
  default_sport: "padel",
  default_sets_to_win: 2,
  default_games_per_set: 6,
  default_tiebreak_at: 6,
  default_golden_point: false,
  sound_enabled: true,
  voice_lang: "id-ID",
  court_name: "Lapangan Utama",
  courts_list: ["Lapangan 1", "Lapangan 2", "Lapangan 3"]
};

const DEFAULT_COURTS = [
  { id: "court_1", name: "Lapangan 1 (HP 1)", active_match: null, last_updated: null },
  { id: "court_2", name: "Lapangan 2 (HP 2)", active_match: null, last_updated: null },
  { id: "court_3", name: "Lapangan 3", active_match: null, last_updated: null }
];

function getKvNamespace(env) {
  if (!env) return null;
  return env.DF_SCORING_KV || env.PADEL_DB || env.KV || null;
}

async function readStore(env, key, defaultVal) {
  const kv = getKvNamespace(env);
  if (kv) {
    try {
      const val = await kv.get(key, { type: "json" });
      if (val !== null && val !== undefined) {
        MEMORY_STORE[key] = val;
        return val;
      }
    } catch (e) {
      // Fallback below
    }
  }

  // Try Cloudflare Edge Cache API
  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://dfscoring-edge-store.internal/${key}`);
    const cachedRes = await cache.match(cacheUrl);
    if (cachedRes) {
      const data = await cachedRes.json();
      MEMORY_STORE[key] = data;
      return data;
    }
  } catch (e) {
    // Fallback to memory store
  }

  if (MEMORY_STORE[key] !== null && MEMORY_STORE[key] !== undefined) {
    return MEMORY_STORE[key];
  }

  const cloned = JSON.parse(JSON.stringify(defaultVal));
  await writeStore(env, key, cloned);
  return cloned;
}

async function writeStore(env, key, data) {
  MEMORY_STORE[key] = data;
  const jsonStr = JSON.stringify(data);

  const kv = getKvNamespace(env);
  if (kv) {
    try {
      await kv.put(key, jsonStr);
    } catch (e) {
      // Continue to cache fallback
    }
  }

  try {
    const cache = caches.default;
    const cacheUrl = new URL(`https://dfscoring-edge-store.internal/${key}`);
    const response = new Response(jsonStr, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=31536000"
      }
    });
    await cache.put(cacheUrl, response);
  } catch (e) {
    // Ignore cache errors
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function nowFormatted() {
  const d = new Date();
  return d.toISOString().replace("T", " ").substring(0, 19);
}

function shortId() {
  return Math.random().toString(36).substring(2, 10);
}

async function updatePlayerStatsFromMatch(env, match) {
  const players = await readStore(env, "players", DEFAULT_PLAYERS);
  const winner = match.winner; // 'team_a' or 'team_b'
  const teamAIds = (match.team_a_players || []).map(p => p && p.id).filter(Boolean);
  const teamBIds = (match.team_b_players || []).map(p => p && p.id).filter(Boolean);
  const teamANames = (match.team_a_players || []).map(p => p && p.name).filter(Boolean);
  const teamBNames = (match.team_b_players || []).map(p => p && p.name).filter(Boolean);

  for (const p of players) {
    const inA = teamAIds.includes(p.id) || teamANames.includes(p.name) || p.name === match.team_a_name;
    const inB = teamBIds.includes(p.id) || teamBNames.includes(p.name) || p.name === match.team_b_name;
    if (inA) {
      p.matches_played = (p.matches_played || 0) + 1;
      if (winner === "team_a") p.matches_won = (p.matches_won || 0) + 1;
      else p.matches_lost = (p.matches_lost || 0) + 1;
    } else if (inB) {
      p.matches_played = (p.matches_played || 0) + 1;
      if (winner === "team_b") p.matches_won = (p.matches_won || 0) + 1;
      else p.matches_lost = (p.matches_lost || 0) + 1;
    }
  }
  await writeStore(env, "players", players);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  // Extract route after /api/
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const segments = path ? path.split("/") : [];

  try {
    // 1. GET /api/info
    if (segments[0] === "info" && method === "GET") {
      return jsonResponse({
        app_name: "DF Scoring",
        local_ip: url.host,
        port: 443,
        network_url: `${url.protocol}//${url.host}`,
        cloud_mode: true
      });
    }

    // 2. GET / POST /api/settings
    if (segments[0] === "settings") {
      const current = await readStore(env, "settings", DEFAULT_SETTINGS);
      if (method === "GET") {
        return jsonResponse({ ...DEFAULT_SETTINGS, ...current });
      }
      if (method === "POST") {
        const body = await request.json();
        const updated = { ...DEFAULT_SETTINGS, ...current, ...body };
        await writeStore(env, "settings", updated);
        return jsonResponse(updated);
      }
    }

    // 3. /api/players & /api/players/:id
    if (segments[0] === "players") {
      let players = await readStore(env, "players", DEFAULT_PLAYERS);

      if (segments.length === 1 && method === "GET") {
        return jsonResponse(players);
      }

      if (segments.length === 1 && method === "POST") {
        const body = await request.json();
        const newPlayer = {
          id: shortId(),
          name: body.name || "Pemain Baru",
          nickname: body.nickname || "",
          photo_url: body.photo_url || "",
          handedness: body.handedness || "Kanan",
          level: body.level || "Intermediate",
          notes: body.notes || "",
          slogan_text: body.slogan_text || "",
          slogan_audio_url: body.slogan_audio_url || "",
          matches_played: 0,
          matches_won: 0,
          matches_lost: 0,
          created_at: nowFormatted()
        };
        players.push(newPlayer);
        await writeStore(env, "players", players);
        return jsonResponse(newPlayer);
      }

      if (segments.length === 2) {
        const playerId = segments[1];
        if (method === "PUT") {
          const body = await request.json();
          const idx = players.findIndex(p => p.id === playerId);
          if (idx === -1) return jsonResponse({ error: "Player not found" }, 404);
          players[idx] = { ...players[idx], ...body, id: playerId };
          await writeStore(env, "players", players);
          return jsonResponse(players[idx]);
        }
        if (method === "DELETE") {
          players = players.filter(p => p.id !== playerId);
          await writeStore(env, "players", players);
          return jsonResponse({ status: "deleted", id: playerId });
        }
      }
    }

    // 4. POST /api/upload-photo (Base64 Data URL for serverless persistence)
    if (segments[0] === "upload-photo" && method === "POST") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) return jsonResponse({ error: "No file uploaded" }, 400);
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const mime = file.type || "image/jpeg";
      const dataUrl = `data:${mime};base64,${base64}`;
      return jsonResponse({ url: dataUrl, filename: file.name || "photo.jpg" });
    }

    // 5. POST /api/upload-audio (Base64 Data URL for serverless persistence)
    if (segments[0] === "upload-audio" && method === "POST") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) return jsonResponse({ error: "No audio uploaded" }, 400);
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const mime = file.type || "audio/webm";
      const dataUrl = `data:${mime};base64,${base64}`;
      return jsonResponse({ url: dataUrl, filename: file.name || "slogan.webm" });
    }

    // 6. /api/courts & /api/courts/:court_id
    if (segments[0] === "courts") {
      const courts = await readStore(env, "courts", DEFAULT_COURTS);

      if (segments.length === 1 && method === "GET") {
        return jsonResponse(courts);
      }

      if (segments.length === 2) {
        const courtId = segments[1];
        if (method === "POST") {
          const data = await request.json();
          const matchData = "match" in data ? data.match : data;
          const courtName = data.court_name || "";
          let found = false;
          for (const c of courts) {
            if (c.id === courtId) {
              c.active_match = matchData;
              if (courtName) c.name = courtName;
              c.last_updated = nowFormatted();
              found = true;
              break;
            }
          }
          if (!found) {
            courts.push({
              id: courtId,
              name: courtName || `Lapangan ${courtId}`,
              active_match: matchData,
              last_updated: nowFormatted()
            });
          }
          await writeStore(env, "courts", courts);
          return jsonResponse({ status: "success", court_id: courtId, active_match: matchData });
        }

        if (method === "DELETE") {
          for (const c of courts) {
            if (c.id === courtId) {
              c.active_match = null;
              c.last_updated = nowFormatted();
              break;
            }
          }
          await writeStore(env, "courts", courts);
          return jsonResponse({ status: "cleared", court_id: courtId });
        }
      }
    }

    // 7. /api/matches & /api/matches/:id
    if (segments[0] === "matches") {
      let matches = await readStore(env, "matches", []);

      if (segments.length === 1 && method === "GET") {
        return jsonResponse(matches);
      }

      if (segments.length === 1 && method === "POST") {
        const match = await request.json();
        const matchId = match.id || shortId();
        match.id = matchId;
        if (!match.date) match.date = nowFormatted();

        const existingIdx = matches.findIndex(m => m.id === matchId);
        if (existingIdx !== -1) {
          matches[existingIdx] = match;
        } else {
          matches.unshift(match);
        }
        await writeStore(env, "matches", matches);

        if (match.status === "completed" && match.winner) {
          await updatePlayerStatsFromMatch(env, match);
        }

        // Optional Google Sheet sync if configured
        const settings = await readStore(env, "settings", DEFAULT_SETTINGS);
        let sheetSynced = false;
        if (settings.auto_sync_sheets && settings.google_sheet_url) {
          try {
            const res = await fetch(settings.google_sheet_url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "match", data: match })
            });
            sheetSynced = res.ok;
          } catch (e) {
            sheetSynced = false;
          }
        }

        return jsonResponse({
          match,
          sheet_synced: sheetSynced
        });
      }

      if (segments.length === 2 && method === "DELETE") {
        const matchId = segments[1];
        matches = matches.filter(m => m.id !== matchId);
        await writeStore(env, "matches", matches);
        return jsonResponse({ status: "deleted", id: matchId });
      }
    }

    // 8. /api/tournaments & /api/tournaments/:id
    if (segments[0] === "tournaments") {
      let tournaments = await readStore(env, "tournaments", []);

      if (segments.length === 1 && method === "GET") {
        return jsonResponse(tournaments);
      }

      if (segments.length === 1 && method === "POST") {
        const tourney = await request.json();
        tourney.id = tourney.id || shortId();
        tourney.created_at = tourney.created_at || nowFormatted();
        tournaments.unshift(tourney);
        await writeStore(env, "tournaments", tournaments);
        return jsonResponse(tourney);
      }

      if (segments.length === 2) {
        const tournId = segments[1];
        if (method === "PUT") {
          const data = await request.json();
          const idx = tournaments.findIndex(t => t.id === tournId);
          if (idx === -1) return jsonResponse({ error: "Tournament not found" }, 404);
          tournaments[idx] = { ...data, id: tournId };
          await writeStore(env, "tournaments", tournaments);
          return jsonResponse(tournaments[idx]);
        }
        if (method === "DELETE") {
          tournaments = tournaments.filter(t => t.id !== tournId);
          await writeStore(env, "tournaments", tournaments);
          return jsonResponse({ status: "deleted", id: tournId });
        }
      }
    }

    // 9. Google Sheet Sync & Test
    if (segments[0] === "sync-sheets" && method === "POST") {
      const settings = await readStore(env, "settings", DEFAULT_SETTINGS);
      if (!settings.google_sheet_url) {
        return jsonResponse({ status: "error", message: "URL Google Sheet belum diatur." }, 400);
      }
      const matches = await readStore(env, "matches", []);
      const players = await readStore(env, "players", DEFAULT_PLAYERS);
      const tournaments = await readStore(env, "tournaments", []);
      try {
        await fetch(settings.google_sheet_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "full_sync", matches, players, tournaments })
        });
        return jsonResponse({ status: "success" });
      } catch (e) {
        return jsonResponse({ status: "error", message: e.message }, 500);
      }
    }

    if (segments[0] === "test-sheet-connection" && method === "POST") {
      const body = await request.json();
      const sheetUrl = body.google_sheet_url;
      if (!sheetUrl) return jsonResponse({ status: "error", message: "URL kosong" }, 400);
      try {
        await fetch(sheetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "ping", timestamp: nowFormatted() })
        });
        return jsonResponse({ status: "success", message: "Koneksi berhasil!" });
      } catch (e) {
        return jsonResponse({ status: "error", message: e.message }, 500);
      }
    }

    // 10. Export CSV / Excel fallback on Edge
    if (segments[0] === "export") {
      const matches = await readStore(env, "matches", []);
      const headers = [
        "ID Pertandingan",
        "Tanggal",
        "Olahraga",
        "Mode",
        "Tim / Pemain A",
        "Tim / Pemain B",
        "Skor Set",
        "Pemenang",
        "Status Menang",
        "Turnamen",
        "Durasi (Menit)"
      ];
      const rows = matches.map(m => {
        const setsScores = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(" | ");
        const winnerName = m.winner === "team_a" ? m.team_a_name : m.winner === "team_b" ? m.team_b_name : "-";
        return [
          m.id || "",
          m.date || "",
          (m.sport || "padel").toUpperCase(),
          (m.mode || "doubles").toUpperCase(),
          m.team_a_name || "",
          m.team_b_name || "",
          setsScores,
          winnerName,
          m.win_reason || "Normal (Skor)",
          m.tournament_name || "Friendly Match",
          m.duration_minutes || 0
        ]
          .map(val => `"${String(val).replace(/"/g, '""')}"`)
          .join(",");
      });
      const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
      return new Response(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="DF_Scoring_Rekap.csv"'
        }
      });
    }

    return jsonResponse({ error: "Endpoint not found", path }, 404);
  } catch (err) {
    return jsonResponse({ error: err.message || "Internal Server Error" }, 500);
  }
}
