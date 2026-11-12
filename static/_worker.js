/**
 * DF Scoring PRO - Full Cloudflare Pages Advanced Mode Worker (_worker.js)
 * Supports Fast Bootstrap (/api/bootstrap), Auth & Role Management (/api/auth/login, /api/users),
 * Admin Analytics & Recalculation (/api/admin/*), Courts, Matches, Tournaments, Players & Google Sheets Sync.
 * Uses Cloudflare D1 for shared state, with a one-time import from legacy KV.
 */

import { TournamentManager } from "./js/tournament.js";
import { MatchScorer } from "./js/scorer.js";
import { ensureSchema, authenticatedUser, startSession, endSession, allowAuthAttempt, googleClientId,
  googleClientIdPattern, verifyGoogleCredential, hashPassword, randomToken, equalValue, digest } from "../server/auth.js";

const DEFAULT_PLAYERS = [];

const DEFAULT_SETTINGS = {
  google_sheet_url: "",
  google_client_id: "",
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
  { id: "court_1", name: "Lapangan 1", active_match: null, last_updated: null },
  { id: "court_2", name: "Lapangan 2", active_match: null, last_updated: null },
  { id: "court_3", name: "Lapangan 3", active_match: null, last_updated: null }
];

const STORE_DEFAULTS = {
  settings: DEFAULT_SETTINGS,
  players: DEFAULT_PLAYERS,
  tournaments: [],
  matches: [],
  users: [],
  courts: DEFAULT_COURTS
};

const REVISION_SQL = "SELECT revision, data_revision FROM df_revision WHERE id = 1";

function fixedCourts(courts = []) {
  return DEFAULT_COURTS.map(court => ({
    ...court,
    ...(courts.find(c => c.id === court.id) || {}),
    name: court.name
  }));
}

function publicCourt(court) {
  if (!court.active_match) return court;
  const { history, redoStack, ...match } = court.active_match;
  return {
    ...court,
    active_match: { ...match, undo_count: history?.length || 0, redo_count: redoStack?.length || 0 }
  };
}

function resumableMatch(match) {
  return match.status === 'completed' && Boolean(match.resumable || (match.win_reason === 'Diselesaikan manual' && match.current_points && match.current_set_games));
}

function makeStore(db) {
  return { db, reads: new Map(), writes: new Map(), statements: [], afterCommit: [] };
}

async function readStore(store, key, defaultValue) {
  if (store.writes.has(key)) return store.writes.get(key);
  if (!store.reads.has(key)) {
    store.reads.set(key, store.db.prepare("SELECT value FROM df_state WHERE key = ? ORDER BY part")
      .bind(key).all().then(({ results }) => results.length
        ? JSON.parse(results.map(row => row.value).join(""))
        : structuredClone(defaultValue)));
  }
  return store.reads.get(key);
}

function writeStore(store, key, data) {
  store.writes.set(key, data);
}

async function commitStore(store, revision) {
  const dataChanged = [...store.writes.keys()].some(key => key !== "courts");
  // A failed CHECK rolls back the whole batch when another request committed first.
  const statements = [store.db.prepare(
    "UPDATE df_revision SET revision = CASE WHEN revision = ? THEN revision + 1 ELSE -1 END, data_revision = data_revision + ? WHERE id = 1"
  ).bind(revision, Number(dataChanged))];
  for (const [key, value] of store.writes) {
    statements.push(store.db.prepare("DELETE FROM df_state WHERE key = ?").bind(key));
    const json = JSON.stringify(value);
    // Keep each value below D1's row size limit, including UTF-8 text.
    const chunkSize = 250000;
    for (let offset = 0, part = 0; offset < json.length; part++) {
      let end = Math.min(offset + chunkSize, json.length);
      if (/[\uD800-\uDBFF]/.test(json[end - 1])) end--;
      statements.push(store.db.prepare("INSERT INTO df_state (key, part, value) VALUES (?, ?, ?)")
        .bind(key, part, json.slice(offset, end)));
      offset = end;
    }
  }
  try {
    await store.db.batch([...statements, ...store.statements]);
    return true;
  } catch (error) {
    const current = await store.db.prepare(REVISION_SQL).first();
    if (current?.revision !== revision) return false;
    throw error;
  }
}

async function initializeStore(env) {
  const db = env.DF_SCORING_DB;
  const current = await db.prepare(REVISION_SQL).first();
  if (current.revision !== 0) return;
  const store = makeStore(db);
  const kv = env.DF_SCORING_KV || env.PADEL_DB;
  for (const [key, fallback] of Object.entries(STORE_DEFAULTS)) {
    const previous = key !== "courts" && kv ? await kv.get(key, { type: "json" }) : null;
    writeStore(store, key, previous ?? fallback);
  }
  await commitStore(store, 0);
}

async function snapshot(db, since = null) {
  const statement = since === null
    ? db.prepare("SELECT key, value FROM df_state ORDER BY key, part")
    : db.prepare(`SELECT key, value FROM df_state WHERE key = 'courts'
        AND (SELECT revision FROM df_revision WHERE id = 1) <> ? ORDER BY part`).bind(since);
  const [meta, rows] = await db.batch([db.prepare(REVISION_SQL), statement]);
  if (since === meta.results[0].revision) return meta.results[0];
  const values = {};
  for (const row of rows.results) (values[row.key] ??= []).push(row.value);
  for (const key of Object.keys(values)) values[key] = JSON.parse(values[key].join(""));
  values.courts = fixedCourts(values.courts).map(publicCourt);
  return { ...values, ...meta.results[0] };
}

function scoredBy(user) {
  return { name: user.name, email: user.email, role: user.role };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
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
  const d = new Date(Date.now() + 7 * 3600 * 1000); // WIB (UTC+7)
  return d.toISOString().replace("T", " ").substring(0, 19);
}

function shortId() {
  return Math.random().toString(36).substring(2, 10);
}

async function recalculateAllPlayerStats(store) {
  const players = await readStore(store, "players", DEFAULT_PLAYERS);
  const matches = await readStore(store, "matches", []);

  for (const p of players) {
    p.matches_played = 0;
    p.matches_won = 0;
    p.matches_lost = 0;
    p.sets_won = 0;
    p.sets_lost = 0;
    p.games_won = 0;
    p.games_lost = 0;
  }

  for (const m of matches) {
    if (m.status !== "completed" || !m.winner) continue;
    const winner = m.winner;
    const teamAIds = (m.team_a_player_ids || []).concat((m.team_a_players || []).map(x => x && x.id)).filter(Boolean);
    const teamBIds = (m.team_b_player_ids || []).concat((m.team_b_players || []).map(x => x && x.id)).filter(Boolean);
    const teamANames = (m.team_a_players || []).map(x => x && x.name && x.name.toLowerCase()).filter(Boolean);
    const teamBNames = (m.team_b_players || []).map(x => x && x.name && x.name.toLowerCase()).filter(Boolean);

    let setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
    for (const s of (m.sets_history || [])) {
      const gA = parseInt(s.team_a);
      const gB = parseInt(s.team_b);
      if (!isNaN(gA) && !isNaN(gB)) {
        gamesA += gA;
        gamesB += gB;
        if (!s.partial) {
          if (s.winner === "team_a" || gA > gB) setsA++;
          else if (s.winner === "team_b" || gB > gA) setsB++;
        }
      } else if (s.winner === "team_a") {
        setsA++;
      } else if (s.winner === "team_b") {
        setsB++;
      }
    }

    for (const p of players) {
      const pNameLower = (p.name || "").toLowerCase();
      const inA = teamAIds.includes(p.id) || teamANames.includes(pNameLower) || pNameLower === (m.team_a_name || "").toLowerCase();
      const inB = teamBIds.includes(p.id) || teamBNames.includes(pNameLower) || pNameLower === (m.team_b_name || "").toLowerCase();

      if (inA) {
        p.matches_played++;
        if (winner === "team_a") p.matches_won++;
        else p.matches_lost++;
        p.sets_won = (p.sets_won || 0) + setsA;
        p.sets_lost = (p.sets_lost || 0) + setsB;
        p.games_won = (p.games_won || 0) + gamesA;
        p.games_lost = (p.games_lost || 0) + gamesB;
      } else if (inB) {
        p.matches_played++;
        if (winner === "team_b") p.matches_won++;
        else p.matches_lost++;
        p.sets_won = (p.sets_won || 0) + setsB;
        p.sets_lost = (p.sets_lost || 0) + setsA;
        p.games_won = (p.games_won || 0) + gamesB;
        p.games_lost = (p.games_lost || 0) + gamesA;
      }
    }
  }

  await writeStore(store, "players", players);
  return players;
}

function validMatchStart(match) {
  const rules = match.rules;
  return typeof match.id === "string" && /^m_[a-z0-9-]{8,40}$/.test(match.id)
    && ["padel", "tennis"].includes(match.sport) && ["singles", "doubles"].includes(match.mode)
    && [match.team_a_name, match.team_b_name].every(name => typeof name === "string" && name.trim() && name.length <= 160)
    && Number.isInteger(rules?.games_per_set) && rules.games_per_set >= 1 && rules.games_per_set <= 50
    && [1, 2, 3].includes(rules.sets_to_win)
    && [match.team_a_players, match.team_b_players].every(players => Array.isArray(players)
      && players.length <= 2 && players.every(player => typeof player?.name === "string"));
}

function serializeActive(scorer) {
  return { ...scorer.toLightJSON(), history: scorer.history, redoStack: scorer.redoStack };
}

function sameFixture(active, match) {
  return active && active.tournament_id === match.tournament_id
    && active.tournament_match_id === match.tournament_match_id;
}

async function findTournament(store, id) {
  const tournaments = await readStore(store, "tournaments", []);
  const tournament = tournaments.find(item => item.id === id);
  return tournament ? TournamentManager.normalize(tournament) : null;
}

async function canReferee(store, user, tournamentId, fixtureId) {
  if (user?.role === 'admin') return true;
  if (!user || !tournamentId || !fixtureId) return false;
  return Boolean(await store.db.prepare('SELECT user_id FROM df_match_referees WHERE tournament_id = ? AND fixture_id = ? AND user_id = ?')
    .bind(tournamentId, fixtureId, user.id).first());
}

function refereeDenied() {
  return jsonResponse({ error: 'Hanya admin atau wasit yang memiliki password turnamen dapat mengubah pertandingan.' }, 403);
}

async function canControlMatch(store, user, match) {
  return match.tournament_id ? canReferee(store, user, match.tournament_id, match.tournament_match_id)
    : user?.role === 'admin' || Boolean(user && match.referee_user_id === user.id);
}

// Reopen only the dependent branch; never invalidate a match already played.
function reopenFixture(tournament, fixtureId, courts) {
  const fixture = TournamentManager.findMatch(tournament, fixtureId);
  if (!fixture) return false;
  const chain = [];
  let previous = fixture;
  if (tournament.format === 'knockout') {
    while (true) {
      const next = tournament.rounds.flatMap(round => round.matches).find(match => match.feeds_from?.includes(previous.id));
      if (!next) break;
      if (next.status === 'completed' || courts.some(court => court.active_match?.tournament_id === tournament.id
        && court.active_match.tournament_match_id === next.id)) return false;
      chain.push({ next, previous });
      previous = next;
    }
  }
  for (const { next, previous } of chain) next[next.feeds_from.indexOf(previous.id) === 0 ? 'team_a' : 'team_b'] = null;
  Object.assign(fixture, { status: 'pending', winner: null, winner_participant: null, sets_history: [],
    score_display: 'vs', win_type: null, win_reason: '' });
  Object.assign(tournament, { status: 'active', champion: null, champion_name: null, revision: (tournament.revision || 0) + 1 });
  return true;
}

async function postSheet(url, payload) {
  const destination = new URL(url);
  if (destination.protocol !== "https:" || destination.hostname !== "script.google.com"
    || !destination.pathname.endsWith("/exec") || destination.username || destination.password) {
    throw new Error("Gunakan URL deployment Google Apps Script yang berakhiran /exec.");
  }
  const response = await fetch(destination, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Google Apps Script menolak permintaan.");
  const result = await response.json().catch(() => null);
  if (result?.status !== "success") throw new Error("Webhook gagal memproses data. Periksa deployment dan akses Apps Script.");
}

async function recordCompletedMatch(store, match) {
  if (match.tournament_id) {
    const tournaments = await readStore(store, "tournaments", []);
    const tournament = await findTournament(store, match.tournament_id);
    const fixture = TournamentManager.findMatch(tournament, match.tournament_match_id);
    if (!TournamentManager.isPlayable(fixture)) return "Pertandingan turnamen ini sudah selesai atau tidak tersedia.";
    match.tournament_name = tournament.name;
    match.team_a_name = fixture.team_a.name;
    match.team_b_name = fixture.team_b.name;
    if (match.win_type === "walkover" && !match.start_time) {
      match.team_a_players = fixture.team_a.players || [fixture.team_a];
      match.team_b_players = fixture.team_b.players || [fixture.team_b];
      match.win_reason = String(match.win_reason || "Menang W.O.").slice(0, 200);
      match.sets_history = [];
    }
    TournamentManager.recordMatchResult(tournament, fixture.id, match);
    tournament.revision = (tournament.revision || 0) + 1;
    tournaments[tournaments.findIndex(item => item.id === tournament.id)] = tournament;
    writeStore(store, "tournaments", tournaments);
  }

  match.date ||= nowFormatted();
  match.winner_name = match[match.winner + "_name"];
  const matches = await readStore(store, "matches", []);
  matches.unshift(match);
  writeStore(store, "matches", matches);
  await recalculateAllPlayerStats(store);

  const settings = await readStore(store, "settings", DEFAULT_SETTINGS);
  const sheetUrl = settings.google_sheet_url || settings.google_sheet_webhook_url;
  if ((settings.auto_sync_sheets ?? settings.auto_sync_sheet) && sheetUrl) {
    store.afterCommit.push(async () => {
      try {
        await postSheet(sheetUrl, { type: "match", data: match });
      } catch (error) {
        console.error("DF Scoring Sheets sync:", error.name);
      }
    });
  }
  return null;
}

async function signIn(context, action) {
  const { request, env, store, auth } = context;
  const url = new URL(request.url);
  const { kind, body } = auth;
  const courtId = DEFAULT_COURTS.some(court => court.id === body.court_id) ? body.court_id : "court_1";
  const admin = kind === "admin";
  const role = admin ? "admin" : "member";
  const provider = admin ? "admin_password" : "google_oauth";
  let name, email, picture, login, account;

  if (admin) {
    if (!env.DF_ADMIN_PASSWORD) {
      return jsonResponse({ error: "Masuk Admin belum aktif. Simpan secret DF_ADMIN_PASSWORD di pengaturan Production Cloudflare, lalu deploy ulang.", code: "ADMIN_NOT_CONFIGURED" }, 503);
    }
    const supplied = typeof body.password === "string" ? body.password.trim() : "";
    if (!supplied || supplied.length > 128 || !equalValue(await digest(supplied), await digest(env.DF_ADMIN_PASSWORD))) {
      return jsonResponse({ error: "Password Admin salah." }, 401);
    }
    name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    name ||= "Admin Utama";
    email = "admin@dfscoring.pro";
  } else if (kind === "google") {
    const settings = await readStore(store, "settings", DEFAULT_SETTINGS);
    const clientId = googleClientId(env, settings);
    if (!clientId) return jsonResponse({ error: "Masuk Google belum disiapkan. Hubungi admin untuk mengaktifkan Google Client ID.", code: "GOOGLE_NOT_CONFIGURED" }, 503);
    if (auth.verifiedGoogle?.aud !== clientId) {
      try {
        auth.verifiedGoogle = await verifyGoogleCredential(body.credential, clientId);
      } catch (error) {
        console.error("Google key verification unavailable:", error.name, error.message);
        return jsonResponse({ error: "Verifikasi Google belum berhasil. Silakan coba tombol Google sekali lagi.", code: "GOOGLE_KEYS_UNAVAILABLE" }, 503);
      }
    }
    if (!auth.verifiedGoogle) return jsonResponse({ error: "Sesi Google tidak valid. Pilih akun Google lagi." }, 401);
    const google = auth.verifiedGoogle;
    email = google.email.toLowerCase().slice(0, 254);
    if (!/@(gmail|googlemail)\.com$/.test(email)) return jsonResponse({ error: "Gunakan akun Gmail untuk menjadi member." }, 403);
    name = typeof google.name === "string" ? google.name.trim().slice(0, 80) : "";
    name ||= email.split("@")[0].slice(0, 80);
    picture = typeof google.picture === "string" && /^https:\/\/[\w.-]+\//.test(google.picture)
      ? google.picture.slice(0, 400) : undefined;
    login = "google:" + google.sub;
  } else {
    return jsonResponse({ error: "Member wajib masuk dengan Google/Gmail." }, 403);
  }

  if (kind === "google") {
    account = await store.db.prepare("SELECT * FROM df_accounts WHERE login = ?").bind(login).first();
    if (!account) {
      const password = body.password;
      if (typeof password !== "string" || password.length < 8 || password.length > 128) {
        return jsonResponse({ requires_password: true, message: "Create Password: buat password akun minimal 8 karakter. Login tetap wajib Google." });
      }
      auth.salt ||= randomToken(16);
      auth.passwordHash ||= await hashPassword(password, auth.salt);
    }
  }
  const users = await readStore(store, "users", []);
  const previous = admin ? users.find(user => user.role === "admin" && user.name === name)
    : users.find(user => user.id === account?.user_id && user.role === "member");
  const id = account?.user_id || previous?.id || "u_" + crypto.randomUUID();
  const playerId = typeof body.player_id === "string" ? body.player_id : "";
  const players = playerId ? await readStore(store, "players", DEFAULT_PLAYERS) : [];
  const profile = {
    id, name, email, role, provider, court_id: courtId,
    picture: picture || previous?.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
    player_id: players.some(player => player.id === playerId) ? playerId : previous?.player_id || null,
    created_at: previous?.created_at || nowFormatted(),
    last_login: nowFormatted(),
    login_count: (previous?.login_count || 0) + 1
  };
  if (!admin && !account) {
    store.statements.push(store.db.prepare(
      "INSERT INTO df_accounts (login, user_id, name, email, salt, password_hash) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(login, id, name, email, auth.salt || null, auth.passwordHash || null));
  }
  writeStore(store, "users", [profile, ...users.filter(user => user.id !== id)]);
  const response = jsonResponse({ status: "success", user: profile }, action === "register" ? 201 : 200);
  response.headers.set("Set-Cookie", await startSession(store, profile, url, request));
  return response;
}

async function handleApi(context) {
  const { request, env, store, user } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }

  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const segments = path ? path.split("/") : [];

  try {
    if (segments[0] === "auth" && segments[1] === "logout" && method === "POST") {
      const response = jsonResponse({ status: "success" });
      response.headers.set("Set-Cookie", await endSession(request, store.db, url));
      return response;
    }

    if (segments[0] === "auth" && segments[1] === "session" && method === "GET") {
      return jsonResponse({ user });
    }

    if (segments[0] === "bootstrap" && method === "GET") {
      const state = await snapshot(store.db);
      state.matches = state.matches.map(match => ({ ...match, resumable: resumableMatch(match) }));
      if (user?.role !== "admin") {
        state.users = [];
        delete state.settings.google_sheet_url;
        delete state.settings.google_sheet_webhook_url;
      }
      const grants = user ? await store.db.prepare("SELECT tournament_id, fixture_id FROM df_match_referees WHERE user_id = ?").bind(user.id).all() : { results: [] };
      return jsonResponse({
        ...state,
        referee_matches: grants.results,
        settings: { ...DEFAULT_SETTINGS, ...state.settings, google_client_id: googleClientId(env, state.settings) },
        info: {
          app_name: "DF Scoring PRO",
          local_ip: url.host,
          port: 443,
          network_url: url.origin,
          cloud_mode: true
        }
      });
    }

    if (segments[0] === "live" && method === "GET") {
      const since = Number(url.searchParams.get("since") ?? -1);
      return jsonResponse(await snapshot(store.db, Number.isSafeInteger(since) ? since : -1));
    }

    // 1. GET /api/info
    if (segments[0] === "info" && method === "GET") {
      return jsonResponse({
        app_name: "DF Scoring PRO",
        local_ip: url.host,
        port: 443,
        network_url: `${url.protocol}//${url.host}`,
        cloud_mode: true
      });
    }

    if (context.auth) return signIn(context, segments[1]);

    if (method !== "GET" && !user) return jsonResponse({ error: "Silakan masuk kembali." }, 401);
    const adminOnly = ["admin", "users", "settings", "sync-sheets", "test-sheet-connection"].includes(segments[0])
      || (["players", "upload-photo", "upload-audio", "upload"].includes(segments[0]) && method !== "GET")
      || (segments[0] === "tournaments" && method === "DELETE")
      || (segments[0] === "courts" && segments[2] === "clear")
      || (segments[0] === "matches" && ["PUT", "DELETE"].includes(method) && segments.length > 1);
    if (adminOnly && user?.role !== "admin") return jsonResponse({ error: "Akses khusus admin." }, 403);

    if (segments[0] === "users") {
      let users = await readStore(store, "users", []);
      if (segments.length === 1 && method === "GET") {
        return jsonResponse(users);
      }
      if (segments.length === 2 && method === "DELETE") {
        const uid = segments[1];
        users = users.filter(u => u.id !== uid);
        writeStore(store, "users", users);
        store.statements.push(store.db.prepare("DELETE FROM df_sessions WHERE user_id = ?").bind(uid));
        return jsonResponse({ status: "deleted", id: uid });
      }
    }

    // 3. /api/admin/*
    if (segments[0] === "admin") {
      if (segments[1] === "recalculate-stats" && method === "POST") {
        const updatedPlayers = await recalculateAllPlayerStats(store);
        return jsonResponse({ status: "success", players: updatedPlayers });
      }

      if (segments[1] === "backup" && method === "GET") {
        const { revision, data_revision, ...data } = await snapshot(store.db);
        return jsonResponse({ backup_version: "4.0", exported_at: nowFormatted(), ...data });
      }

      if (segments[1] === "restore" && method === "POST") {
        const data = await request.json();
        if (Array.isArray(data.players)) await writeStore(store, "players", data.players);
        if (Array.isArray(data.matches)) await writeStore(store, "matches", data.matches);
        if (Array.isArray(data.tournaments)) await writeStore(store, "tournaments", data.tournaments);
        const courts = await readStore(store, "courts", DEFAULT_COURTS);
        if (courts.some(court => court.active_match)) {
          return jsonResponse({ error: "Selesaikan semua pertandingan aktif sebelum memulihkan database." }, 409);
        }
        if (Array.isArray(data.users)) await writeStore(store, "users", data.users);
        if (data.settings && typeof data.settings === "object") {
          await writeStore(store, "settings", { ...DEFAULT_SETTINGS, ...data.settings });
        }
        return jsonResponse({ status: "success", message: "Database berhasil dipulihkan!" });
      }
    }

    // 4. GET / POST /api/settings
    if (segments[0] === "settings") {
      const current = await readStore(store, "settings", DEFAULT_SETTINGS);
      if (method === "GET") {
        return jsonResponse({ ...DEFAULT_SETTINGS, ...current });
      }
      if (method === "POST") {
        const body = await request.json();
        if (body.google_client_id && (typeof body.google_client_id !== "string" || !googleClientIdPattern.test(body.google_client_id))) {
          return jsonResponse({ error: "OAuth Client ID Google harus berakhiran .apps.googleusercontent.com." }, 400);
        }
        const updated = { ...DEFAULT_SETTINGS, ...current, ...body };
        await writeStore(store, "settings", updated);
        return jsonResponse(updated);
      }
    }

    // 5. /api/players & /api/players/:id
    if (segments[0] === "players") {
      let players = await readStore(store, "players", DEFAULT_PLAYERS);

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
          sets_won: 0,
          sets_lost: 0,
          games_won: 0,
          games_lost: 0,
          created_at: nowFormatted()
        };
        players.push(newPlayer);
        await writeStore(store, "players", players);
        return jsonResponse(newPlayer);
      }

      if (segments.length === 2) {
        const playerId = segments[1];
        if (method === "PUT") {
          const body = await request.json();
          const idx = players.findIndex(p => p.id === playerId);
          if (idx === -1) return jsonResponse({ error: "Player not found" }, 404);
          players[idx] = { ...players[idx], ...body, id: playerId };
          await writeStore(store, "players", players);
          return jsonResponse(players[idx]);
        }
        if (method === "DELETE") {
          players = players.filter(p => p.id !== playerId);
          await writeStore(store, "players", players);
          return jsonResponse({ status: "deleted", id: playerId });
        }
      }
    }

    // 6. POST /api/upload-photo & /api/upload-audio
    if ((segments[0] === "upload-photo" || segments.join("/") === "upload/photo") && method === "POST") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) return jsonResponse({ error: "No file uploaded" }, 400);
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const mime = file.type || "image/jpeg";
      const dataUrl = `data:${mime};base64,${base64}`;
      return jsonResponse({ url: dataUrl, filename: file.name || "photo.jpg" });
    }

    if ((segments[0] === "upload-audio" || segments.join("/") === "upload/audio") && method === "POST") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) return jsonResponse({ error: "No audio uploaded" }, 400);
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const mime = file.type || "audio/webm";
      const dataUrl = `data:${mime};base64,${base64}`;
      return jsonResponse({ url: dataUrl, filename: file.name || "slogan.webm" });
    }

    if (segments[0] === "courts") {
      const courts = fixedCourts(await readStore(store, "courts", DEFAULT_COURTS));
      if (segments.length === 1 && method === "GET") return jsonResponse(courts.map(publicCourt));

      const court = courts.find(c => c.id === segments[1]);
      if (!court) return jsonResponse({ error: "Lapangan tidak tersedia." }, 404);
      if (method !== "POST" || segments.length !== 3) {
        return jsonResponse({ error: "Gunakan alur pertandingan terbaru. Muat ulang halaman." }, 405);
      }

      const body = await request.json();
      const action = segments[2];
      const active = court.active_match;
      const conflict = message => jsonResponse({ error: message, court: publicCourt(court) }, 409);
      let result;
      if (action === "start") {
        if (active) {
          if (active.id === body.id) return jsonResponse({ court: publicCourt(court) });
          return conflict("Lapangan sedang dipakai.");
        }
        if (!validMatchStart(body)) return jsonResponse({ error: "Lengkapi data pertandingan." }, 400);
        const matches = await readStore(store, "matches", []);
        if (matches.some(match => match.id === body.id)) return conflict("Pertandingan ini sudah selesai.");
        if (body.tournament_id || body.tournament_match_id) {
          const tourney = await findTournament(store, body.tournament_id);
          const match = TournamentManager.findMatch(tourney, body.tournament_match_id);
          if (!TournamentManager.isPlayable(match) || courts.some(c => sameFixture(c.active_match, body))) {
            return conflict("Pertandingan turnamen ini sudah dimainkan atau sedang berlangsung.");
          }
          body.team_a_name = match.team_a.name;
          body.team_b_name = match.team_b.name;
          body.team_a_players = match.team_a.players || [match.team_a];
          body.team_b_players = match.team_b.players || [match.team_b];
          body.tournament_name = tourney.name;
          body.sport = tourney.sport || body.sport;
          body.mode = tourney.mode || body.mode;
          body.rules = { ...body.rules, ...tourney.rules, tiebreak_at: tourney.rules?.games_per_set || body.rules.games_per_set };
        }
        const cleanPlayers = players => players.map(player => ({ id: player.id, name: player.name }));
        if (body.tournament_id && !await canReferee(store, user, body.tournament_id, body.tournament_match_id)) return refereeDenied();
        const scorer = new MatchScorer({
          id: body.id, sport: body.sport, mode: body.mode, rules: body.rules,
          team_a_name: body.team_a_name, team_b_name: body.team_b_name,
          team_a_players: cleanPlayers(body.team_a_players), team_b_players: cleanPlayers(body.team_b_players),
          tournament_id: body.tournament_id, tournament_match_id: body.tournament_match_id,
          tournament_name: body.tournament_name, court_id: court.id, scored_by: scoredBy(user)
        });
        court.active_match = { ...serializeActive(scorer), referee_user_id: user.id };
      } else {
        if (active && !await canControlMatch(store, user, active)) return refereeDenied();
        if (action === "finish" && active?.id !== body.match_id) {
          const matches = await readStore(store, "matches", []);
          result = matches.find(match => match.id === body.match_id && match.court_id === court.id);
          if (result) return jsonResponse({ court: publicCourt(court), match: result });
        }
        if (!active || active.id !== body.match_id || active.version !== body.version) {
          return conflict("Skor sudah berubah di perangkat lain. Periksa skor terbaru.");
        }
        if (action === "clear" || action === "cancel") {
          if (active.tournament_id) store.statements.push(store.db.prepare('DELETE FROM df_match_referees WHERE tournament_id = ? AND fixture_id = ?').bind(active.tournament_id, active.tournament_match_id));
          court.active_match = null;
        } else {
          const scorer = MatchScorer.fromJSON(active);
          if (action === "score") {
            if (!scorer.applyAction(body.action)) return jsonResponse({ error: "Aksi skor tidak tersedia." }, 400);
            scorer.scored_by = scoredBy(user);
            court.active_match = { ...serializeActive(scorer), referee_user_id: active.referee_user_id };
          } else if (action === "finish") {
            const resumeState = !scorer.is_completed ? serializeActive(scorer) : null;
            if (!scorer.is_completed && !scorer.finishEarly(body.winner)) {
              return jsonResponse({ error: "Pilih pemenang untuk menyelesaikan pertandingan." }, 400);
            }
            scorer.duration_seconds = Math.max(0, Math.floor(((scorer.end_time || new Date()) - scorer.start_time) / 1000));
            scorer.duration_minutes = Math.max(1, Math.round(scorer.duration_seconds / 60));
            result = { ...scorer.toLightJSON(), status: "completed", scored_by: scoredBy(user) };
            result.referee_user_id = active.referee_user_id;
            result.resumable = Boolean(resumeState);
            if (resumeState) store.statements.push(store.db.prepare("INSERT OR REPLACE INTO df_resume_states (match_id, state) VALUES (?, ?)")
              .bind(result.id, JSON.stringify({ ...resumeState, referee_user_id: active.referee_user_id })));
            const error = await recordCompletedMatch(store, result);
            if (error) return conflict(error);
            if (active.tournament_id) store.statements.push(store.db.prepare('DELETE FROM df_match_referees WHERE tournament_id = ? AND fixture_id = ?').bind(active.tournament_id, active.tournament_match_id));
            court.active_match = null;
          } else {
            return jsonResponse({ error: "Aksi lapangan tidak tersedia." }, 404);
          }
        }
      }

      court.last_updated = nowFormatted();
      writeStore(store, "courts", courts);
      return jsonResponse({ court: publicCourt(court), match: result });
    }

    // 8. /api/matches & /api/matches/:id
    if (segments[0] === "matches") {
      let matches = await readStore(store, "matches", []);

      if (segments.length === 3 && segments[2] === 'resume' && method === 'POST') {
        const previous = matches.find(match => match.id === segments[1]);
        if (!previous) return jsonResponse({ error: 'Riwayat tidak ditemukan atau sudah dilanjutkan.' }, 409);
        if (!await canControlMatch(store, user, previous)) return refereeDenied();
        const saved = await store.db.prepare('SELECT state FROM df_resume_states WHERE match_id = ?').bind(previous.id).first();
        if (!resumableMatch(previous)) return jsonResponse({ error: 'Hanya pertandingan yang diselesaikan manual yang dapat dilanjutkan.' }, 400);
        const body = await request.json();
        const courts = fixedCourts(await readStore(store, 'courts', DEFAULT_COURTS));
        const court = courts.find(item => item.id === body.court_id);
        if (!court || court.active_match) return jsonResponse({ error: 'Pilih lapangan yang masih kosong.' }, 409);
        if (previous.tournament_id) {
          const tournaments = await readStore(store, 'tournaments', []);
          const tournament = await findTournament(store, previous.tournament_id);
          if (!tournament || courts.some(item => sameFixture(item.active_match, previous))
            || !reopenFixture(tournament, previous.tournament_match_id, courts)) {
            return jsonResponse({ error: 'Babak lanjutan sudah dimainkan. Pertandingan ini tidak dapat dibuka kembali.' }, 409);
          }
          writeStore(store, 'tournaments', tournaments.map(item => item.id === tournament.id ? tournament : item));
        }
        // Older manual results already contain the points and service state.
        const state = saved ? JSON.parse(saved.state) : {
          ...previous, status: 'active', is_completed: false, winner: null, end_time: null,
          win_reason: '', win_type: null, sets_history: (previous.sets_history || []).filter(set => !set.partial), history: [], redoStack: []
        };
        delete state.resumable;
        const elapsed = (previous.duration_seconds || 0) * 1000;
        court.active_match = { ...state, court_id: court.id, version: Math.max(previous.version || 1, state.version || 1) + 1,
          start_time: new Date(Date.now() - elapsed).toISOString() };
        court.last_updated = nowFormatted();
        writeStore(store, 'courts', courts);
        writeStore(store, 'matches', matches.filter(match => match.id !== previous.id));
        store.statements.push(store.db.prepare('DELETE FROM df_resume_states WHERE match_id = ?').bind(previous.id));
        await recalculateAllPlayerStats(store);
        return jsonResponse({ court: publicCourt(court) });
      }

      if (segments.length === 1 && method === "GET") {
        return jsonResponse(matches);
      }

      // Direct walkover from a bracket, without claiming an empty court.
      if (segments.length === 1 && method === "POST") {
        const match = await request.json();
        if (!match.tournament_id || !match.tournament_match_id || match.win_type !== "walkover"
          || !["team_a", "team_b"].includes(match.winner)) {
          return jsonResponse({ error: "Selesaikan pertandingan aktif dari papan skor." }, 400);
        }
        if (!await canReferee(store, user, match.tournament_id, match.tournament_match_id)) return refereeDenied();
        const courts = await readStore(store, "courts", DEFAULT_COURTS);
        if (courts.some(c => sameFixture(c.active_match, match))) {
          return jsonResponse({ error: "Selesaikan pertandingan ini dari papan skor lapangan." }, 409);
        }
        const result = {
          id: shortId(), tournament_id: match.tournament_id, tournament_match_id: match.tournament_match_id,
          sport: match.sport, mode: match.mode, court_id: match.court_id,
          winner: match.winner, win_type: "walkover", win_reason: match.win_reason,
          status: "completed", scored_by: scoredBy(user), duration_minutes: 0
        };
        const error = await recordCompletedMatch(store, result);
        if (error) return jsonResponse({ error }, 409);
        return jsonResponse({ status: "success", match: result });
      }

      if (segments.length === 2 && ["PUT", "DELETE"].includes(method)) {
        const matchId = segments[1];
        const idx = matches.findIndex(m => m.id === matchId);
        if (idx === -1) return jsonResponse({ error: "Pertandingan tidak ditemukan." }, 404);
        const previous = matches[idx];
        const tournament = previous.status !== "replayed" && previous.tournament_id && await findTournament(store, previous.tournament_id);
        if (method === "PUT") {
          if (previous.status === "replayed") return jsonResponse({ error: "Hasil lama yang sudah diulang disimpan sebagai arsip. Koreksi hasil pertandingan terbaru." }, 409);
          const body = await request.json();
          const updated = { ...previous, ...body, id: matchId };
          if (tournament) {
            if (updated.winner !== previous.winner) {
              return jsonResponse({ error: "Pemenang turnamen sudah dipakai di bagan." }, 409);
            }
            const fixture = TournamentManager.findMatch(tournament, previous.tournament_match_id);
            if (fixture) {
              fixture.status = "pending";
              TournamentManager.recordMatchResult(tournament, fixture.id, updated);
              tournament.revision = (tournament.revision || 0) + 1;
              const tournaments = await readStore(store, "tournaments", []);
              writeStore(store, "tournaments", tournaments.map(item => item.id === tournament.id ? tournament : item));
            }
          }
          matches[idx] = updated;
          writeStore(store, "matches", matches);
          await recalculateAllPlayerStats(store);
          return jsonResponse({ status: "updated", match: updated });
        }
        if (tournament) return jsonResponse({ error: "Hasil ini masih dipakai di bagan turnamen." }, 409);
        matches = matches.filter(m => m.id !== matchId);
        writeStore(store, "matches", matches);
        await recalculateAllPlayerStats(store);
        return jsonResponse({ status: "deleted", id: matchId });
      }
    }

    // 9. /api/tournaments & /api/tournaments/:id
    if (segments[0] === "tournaments") {
      let tournaments = await readStore(store, "tournaments", []);

      if (segments.length === 3 && ['unlock', 'password', 'replay'].includes(segments[2]) && method === 'POST') {
        const tournament = tournaments.find(item => item.id === segments[1]);
        if (!tournament) return jsonResponse({ error: 'Turnamen tidak ditemukan.' }, 404);
        if (!await allowAuthAttempt(request, store.db, 'referee:' + user.id)) return jsonResponse({ error: 'Terlalu banyak percobaan. Tunggu 5 menit.' }, 429);
        const body = await request.json();
        if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
          return jsonResponse({ error: 'Password turnamen minimal 8 karakter.' }, 400);
        }
        if (segments[2] === 'password') {
          if (user.role !== 'admin') return refereeDenied();
          const salt = randomToken(16);
          store.statements.push(store.db.prepare('INSERT OR REPLACE INTO df_tournament_access VALUES (?, ?, ?)')
            .bind(tournament.id, salt, await hashPassword(body.password, salt)),
            store.db.prepare('DELETE FROM df_match_referees WHERE tournament_id = ?').bind(tournament.id));
          tournament.password_protected = true;
          writeStore(store, 'tournaments', tournaments);
          return jsonResponse({ status: 'success' });
        }
        const secret = await store.db.prepare('SELECT salt, password_hash FROM df_tournament_access WHERE tournament_id = ?').bind(tournament.id).first();
        if (!secret) return jsonResponse({ error: 'Admin perlu mengatur password untuk turnamen lama ini.' }, 409);
        if (!equalValue(await hashPassword(body.password, secret.salt), secret.password_hash)) {
          return jsonResponse({ error: 'Password turnamen salah.' }, 403);
        }
        const fixture = TournamentManager.findMatch(TournamentManager.normalize(tournament), body.fixture_id);
        if (!fixture || fixture.team_a?.is_bye || fixture.team_b?.is_bye) return jsonResponse({ error: 'Pilih match yang ingin Anda wasiti.' }, 400);
        if (segments[2] === 'replay') {
          const current = TournamentManager.normalize(tournament);
          const courts = fixedCourts(await readStore(store, 'courts', DEFAULT_COURTS));
          const court = courts.find(item => item.id === body.court_id);
          if (!court || court.active_match || courts.some(item => sameFixture(item.active_match, { tournament_id: tournament.id, tournament_match_id: fixture.id }))) {
            return jsonResponse({ error: 'Pilih lapangan kosong. Match ini mungkin sudah dimainkan ulang.' }, 409);
          }
          if (fixture.status !== 'completed' || !reopenFixture(current, fixture.id, courts)) {
            return jsonResponse({ error: 'Match tidak dapat diulang karena babak berikutnya sudah dimainkan atau match belum selesai.' }, 409);
          }
          const scorer = new MatchScorer({
            id: 'm_' + crypto.randomUUID(), sport: current.sport, mode: current.mode,
            rules: { ...current.rules, tiebreak_at: current.rules?.games_per_set || 6 },
            team_a_name: fixture.team_a.name, team_b_name: fixture.team_b.name,
            team_a_players: fixture.team_a.players || [fixture.team_a], team_b_players: fixture.team_b.players || [fixture.team_b],
            tournament_id: current.id, tournament_match_id: fixture.id, tournament_name: current.name,
            court_id: court.id, scored_by: scoredBy(user)
          });
          court.active_match = { ...serializeActive(scorer), referee_user_id: user.id };
          court.last_updated = nowFormatted();
          writeStore(store, 'courts', courts);
          writeStore(store, 'tournaments', tournaments.map(item => item.id === current.id ? current : item));
          const matches = await readStore(store, 'matches', []);
          writeStore(store, 'matches', matches.map(match => match.tournament_id === current.id && match.tournament_match_id === fixture.id
            && match.status === 'completed' ? { ...match, status: 'replayed', resumable: false } : match));
          await recalculateAllPlayerStats(store);
          store.statements.push(store.db.prepare('DELETE FROM df_match_referees WHERE tournament_id = ? AND fixture_id = ?').bind(current.id, fixture.id),
            store.db.prepare('INSERT INTO df_match_referees VALUES (?, ?, ?)').bind(current.id, fixture.id, user.id));
          return jsonResponse({ status: 'success', court: publicCourt(court) });
        }
        store.statements.push(store.db.prepare('INSERT OR IGNORE INTO df_match_referees VALUES (?, ?, ?)').bind(tournament.id, fixture.id, user.id));
        return jsonResponse({ status: 'success', tournament_id: tournament.id, fixture_id: fixture.id });
      }

      if (segments.length === 1 && method === "GET") {
        return jsonResponse(tournaments);
      }

      if (segments.length === 1 && method === "POST") {
        const tourney = await request.json();
        if (!tourney.name || !Array.isArray(tourney.participants) || tourney.participants.length < 2
          || !Array.isArray(tourney.rounds) || !tourney.rounds.length) {
          return jsonResponse({ error: "Bagan atau jadwal turnamen belum lengkap." }, 400);
        }
        const password = tourney.password;
        if (typeof password !== "string" || password.length < 8 || password.length > 128) {
          return jsonResponse({ error: "Create Password turnamen minimal 8 karakter." }, 400);
        }
        delete tourney.password;
        delete tourney.password_hash;
        delete tourney.salt;
        tourney.created_by = user.id;
        tourney.password_protected = true;
        tourney.revision = 1;
        tourney.id = "tourn_" + shortId();
        tourney.created_at = tourney.created_at || nowFormatted();
        const salt = randomToken(16);
        store.statements.push(store.db.prepare("INSERT INTO df_tournament_access VALUES (?, ?, ?)")
          .bind(tourney.id, salt, await hashPassword(password, salt)));
        tournaments.unshift(tourney);
        await writeStore(store, "tournaments", tournaments);
        return jsonResponse(tourney);
      }

      if (segments.length === 2) {
        const tournId = segments[1];
        const idx = tournaments.findIndex(t => t.id === tournId);
        if (idx === -1) return jsonResponse({ error: "Turnamen tidak ditemukan." }, 404);
        const courts = await readStore(store, "courts", DEFAULT_COURTS);
        if (method !== "DELETE" && courts.some(court => court.active_match?.tournament_id === tournId)) {
          return jsonResponse({ error: "Selesaikan pertandingan aktif turnamen ini terlebih dahulu." }, 409);
        }
        if (method === "PUT") {
          if (user.role !== "admin") return refereeDenied();
          const data = await request.json();
          const current = tournaments[idx];
          if ((data.revision || 0) !== (current.revision || 0) || TournamentManager.hasResults(current)) {
            return jsonResponse({ error: "Bagan telah berubah atau sudah memiliki hasil pertandingan." }, 409);
          }
          delete data.password;
          tournaments[idx] = { ...data, created_by: current.created_by, password_protected: current.password_protected,
            id: tournId, revision: (current.revision || 0) + 1 };
          await writeStore(store, "tournaments", tournaments);
          return jsonResponse({ status: "updated", tournament: tournaments[idx] });
        }
        if (method === "DELETE") {
          for (const court of courts) if (court.active_match?.tournament_id === tournId) {
            court.active_match = null;
            court.last_updated = nowFormatted();
          }
          writeStore(store, "courts", courts);
          const matches = await readStore(store, "matches", []);
          // Keep history and statistics; detach it from the deleted bracket.
          writeStore(store, "matches", matches.map(match => match.tournament_id === tournId
            ? { ...match, tournament_id: null, tournament_match_id: null } : match));
          store.statements.push(store.db.prepare("DELETE FROM df_tournament_access WHERE tournament_id = ?").bind(tournId),
            store.db.prepare("DELETE FROM df_match_referees WHERE tournament_id = ?").bind(tournId));
          tournaments = tournaments.filter(t => t.id !== tournId);
          await writeStore(store, "tournaments", tournaments);
          return jsonResponse({ status: "deleted", id: tournId });
        }
      }
    }

    // 10. Google Sheet Sync & Test
    if (segments[0] === "sync-sheets" && method === "POST") {
      const settings = await readStore(store, "settings", DEFAULT_SETTINGS);
      const sheetUrl = settings.google_sheet_url || settings.google_sheet_webhook_url;
      if (!sheetUrl) return jsonResponse({ error: "URL Google Sheet belum diatur." }, 400);
      const data = await snapshot(store.db);
      try {
        await postSheet(sheetUrl, {
          type: "bulk_sync", matches: data.matches, players: data.players, tournaments: data.tournaments
        });
        return jsonResponse({ status: "success", synced_count: data.matches.length });
      } catch (error) {
        return jsonResponse({ error: error.message }, 502);
      }
    }

    if (segments[0] === "test-sheet-connection" && method === "POST") {
      const body = await request.json();
      if (!body.google_sheet_url) return jsonResponse({ error: "URL Google Apps Script masih kosong." }, 400);
      try {
        await postSheet(body.google_sheet_url, { type: "ping", timestamp: nowFormatted() });
        return jsonResponse({ status: "success" });
      } catch (error) {
        return jsonResponse({ error: error.message }, 502);
      }
    }

    // 11. Export CSV / Excel fallback on Edge
    if (segments[0] === "export") {
      const matches = await readStore(store, "matches", []);
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
        "Lapangan",
        "Dicatat Oleh",
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
          m.court_id || "court_1",
          m.scored_by?.name || "-",
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
    if (err instanceof SyntaxError) return jsonResponse({ error: "Data permintaan tidak valid." }, 400);
    throw err;
  }
}

export async function onRequest({ request, env, waitUntil }) {
  const db = env.DF_SCORING_DB;
  if (!db) {
    return jsonResponse({
      error: "Database bersama belum terhubung. Pasang binding D1 DF_SCORING_DB di Production Cloudflare, lalu deploy ulang.",
      code: "DATABASE_NOT_BOUND"
    }, 503);
  }

  try {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && request.method !== "GET" && request.method !== "OPTIONS" && origin !== url.origin) {
      return jsonResponse({ error: "Buka aplikasi dari domain DF Scoring untuk melanjutkan." }, 403);
    }
    await ensureSchema(db);
    await initializeStore(env);

    const authAction = url.pathname.match(/^\/api\/auth\/(login|register|google)\/?$/)?.[1];
    let auth;
    if (request.method === "POST" && authAction) {
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
        return jsonResponse({ error: "Format permintaan login tidak valid." }, 415);
      }
      let body;
      try { body = await request.clone().json(); } catch {
        return jsonResponse({ error: "Data formulir login tidak valid." }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ error: "Data formulir login tidak valid." }, 400);
      }
      const kind = authAction === "google" ? "google" : authAction === "login" && body.role === "admin" ? "admin" : "email";
      if (!await allowAuthAttempt(request, db, kind)) {
        return jsonResponse({ error: "Terlalu banyak percobaan. Tunggu 5 menit dan coba lagi." }, 429);
      }
      auth = { kind, body };
    }
    const publicRead = request.method === "GET" && ["/api/live", "/api/courts", "/api/info"].includes(url.pathname);
    const user = publicRead || auth ? null : await authenticatedUser(request, db);
    const readOnly = ["GET", "OPTIONS"].includes(request.method);
    for (let attempt = 0; attempt < 6; attempt++) {
      const store = makeStore(db);
      const meta = readOnly ? null : await db.prepare(REVISION_SQL).first();
      const response = await handleApi({ request: readOnly ? request : request.clone(), env, store, user, auth });
      if (!response.ok || (!store.writes.size && !store.statements.length)) {
        if (meta) response.headers.set("X-DF-Revision", String(meta.revision));
        return response;
      }
      if (await commitStore(store, meta.revision)) {
        response.headers.set("X-DF-Revision", String(meta.revision + 1));
        for (const task of store.afterCommit) {
          const work = task();
          if (waitUntil) waitUntil(work);
          else await work;
        }
        return response;
      }
    }
    return jsonResponse({ error: "Database sedang sibuk. Coba lagi." }, 409);
  } catch (error) {
    console.error("DF Scoring database:", error.message);
    return jsonResponse({ error: "Database bersama belum tersedia. Periksa binding dan schema D1." }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return onRequest({ request, env, waitUntil: ctx?.waitUntil.bind(ctx) });
    }
    return env.ASSETS.fetch(request);
  }
};
