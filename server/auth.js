const DB_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS df_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0), data_revision INTEGER NOT NULL)",
  "INSERT OR IGNORE INTO df_revision VALUES (1, 0, 0)",
  "CREATE TABLE IF NOT EXISTS df_state (key TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key, part))",
  "CREATE TABLE IF NOT EXISTS df_accounts (login TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, salt TEXT, password_hash TEXT)",
  "CREATE TABLE IF NOT EXISTS df_sessions (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL, profile TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS df_sessions_by_user ON df_sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS df_sessions_by_expiry ON df_sessions(expires)",
  "CREATE TABLE IF NOT EXISTS df_auth_attempts (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS df_auth_attempts_by_expiry ON df_auth_attempts(expires)",
  "CREATE TABLE IF NOT EXISTS df_tournament_access (tournament_id TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS df_referee_grants (tournament_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (tournament_id, user_id))",
  "CREATE TABLE IF NOT EXISTS df_resume_states (match_id TEXT PRIMARY KEY, state TEXT NOT NULL)"
];

const initializedSchemas = new WeakMap();

function ensureSchema(db) {
  if (!initializedSchemas.has(db)) {
    const initialization = db.prepare("SELECT name FROM sqlite_master WHERE name = 'df_resume_states'")
      .first().then(marker => marker || db.batch(DB_SCHEMA.map(sql => db.prepare(sql))))
      .catch(error => {
        initializedSchemas.delete(db);
        throw error;
      });
    initializedSchemas.set(db, initialization);
  }
  return initializedSchemas.get(db);
}

const utf8 = new TextEncoder();
const googleClientIdPattern = /^[\w-]+\.apps\.googleusercontent\.com$/;
const passwordIterations = 100000;
const sessionLifetime = 7 * 86400;
const sessionCookieName = "df_session_v2";
const googlePublicKeysUrl = "https://www.googleapis.com/oauth2/v3/certs";
let googleKeys = { keys: [], expires: 0 };

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
}

function randomToken(size) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function digest(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(value))));
}

function equalValue(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations: passwordIterations
  }, key, 256);
  return base64Url(new Uint8Array(hash));
}

function googleClientId(env, settings) {
  const clientId = (env.GOOGLE_CLIENT_ID || settings?.google_client_id || "").trim();
  return googleClientIdPattern.test(clientId) ? clientId : "";
}

async function verifyGoogleCredential(credential, audience) {
  if (typeof credential !== "string" || credential.length > 8192) return null;
  const pieces = credential.split(".");
  if (pieces.length !== 3 || pieces.some(piece => !/^[\w-]+$/.test(piece))) return null;

  const [head, payload, signature] = pieces;
  let header, claims;
  try {
    const decoder = new TextDecoder();
    header = JSON.parse(decoder.decode(fromBase64Url(head)));
    claims = JSON.parse(decoder.decode(fromBase64Url(payload)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (header?.alg !== "RS256" || typeof header.kid !== "string" || claims?.aud !== audience
    || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)
    || !Number.isInteger(claims.exp) || claims.exp <= now
    || !Number.isInteger(claims.iat) || claims.iat > now + 60
    || claims.email_verified !== true || typeof claims.email !== "string"
    || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return null;

  if (Date.now() >= googleKeys.expires) {
    const response = await fetch(googlePublicKeysUrl, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Google public keys unavailable");
    const { keys } = await response.json();
    const maxAge = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] || 300);
    googleKeys = { keys, expires: Date.now() + Math.min(maxAge, 3600) * 1000 };
  }

  const jwk = googleKeys.keys.find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64Url(signature), utf8.encode(head + "." + payload));
    return valid ? claims : null;
  } catch {
    return null;
  }
}

function sessionToken(request) {
  return request.headers.get("Cookie")?.match(/(?:^|;\s*)df_session_v2=([\w-]{43})(?:;|$)/)?.[1];
}

function sessionCookie(value, url) {
  const maxAge = value ? sessionLifetime : 0;
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function authenticatedUser(request, db) {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await db.prepare("SELECT profile FROM df_sessions WHERE digest = ? AND expires > ?")
    .bind(await digest(token), Date.now()).first();
  const user = row ? JSON.parse(row.profile) : null;
  return user?.role === 'member' && user.provider !== 'google_oauth' ? null : user;
}

async function startSession(store, user, url, request) {
  const token = randomToken(32);
  const existing = sessionToken(request);
  if (existing) {
    store.statements.push(store.db.prepare("DELETE FROM df_sessions WHERE digest = ?").bind(await digest(existing)));
  }
  const now = Date.now();
  store.statements.push(
    store.db.prepare("DELETE FROM df_sessions WHERE expires <= ?").bind(now),
    store.db.prepare("INSERT INTO df_sessions (digest, user_id, expires, profile) VALUES (?, ?, ?, ?)")
      .bind(await digest(token), user.id, now + sessionLifetime * 1000, JSON.stringify(user))
  );
  return sessionCookie(token, url);
}

async function endSession(request, db, url) {
  const token = sessionToken(request);
  if (token) await db.prepare("DELETE FROM df_sessions WHERE digest = ?").bind(await digest(token)).run();
  return sessionCookie("", url);
}

async function allowAuthAttempt(request, db, kind) {
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = await digest(kind + ":" + ip);
  const maximum = kind === "admin" || kind.startsWith("referee:") ? 8 : 60;
  const [, result] = await db.batch([
    db.prepare("DELETE FROM df_auth_attempts WHERE expires <= ?").bind(now),
    db.prepare(`INSERT INTO df_auth_attempts (bucket, hits, expires) VALUES (?, 1, ?)
      ON CONFLICT (bucket) DO UPDATE SET hits = hits + 1 WHERE hits < ? RETURNING hits`)
      .bind(bucket, now + 5 * 60000, maximum)
  ]);
  return result.results.length > 0;
}

export { ensureSchema, authenticatedUser, startSession, endSession, allowAuthAttempt, googleClientId,
  googleClientIdPattern, verifyGoogleCredential, hashPassword, randomToken, equalValue, digest };
