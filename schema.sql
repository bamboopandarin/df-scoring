CREATE TABLE IF NOT EXISTS df_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  data_revision INTEGER NOT NULL
);

INSERT OR IGNORE INTO df_revision VALUES (1, 0, 0);

CREATE TABLE IF NOT EXISTS df_state (
  key TEXT NOT NULL,
  part INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (key, part)
);

CREATE TABLE IF NOT EXISTS df_accounts (
  login TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  salt TEXT,
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS df_sessions (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  profile TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS df_sessions_by_user ON df_sessions(user_id);
CREATE INDEX IF NOT EXISTS df_sessions_by_expiry ON df_sessions(expires);

CREATE TABLE IF NOT EXISTS df_auth_attempts (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS df_auth_attempts_by_expiry ON df_auth_attempts(expires);

CREATE TABLE IF NOT EXISTS df_tournament_access (
  tournament_id TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS df_referee_grants (
  tournament_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (tournament_id, user_id)
);
CREATE TABLE IF NOT EXISTS df_resume_states (
  match_id TEXT PRIMARY KEY, state TEXT NOT NULL
);
