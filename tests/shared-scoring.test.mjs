import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { TournamentManager } from '../static/js/tournament.js';
import { localD1 } from '../tools/local-d1.mjs';
import { ensureSchema, digest, randomToken } from '../server/auth.js';

const { default: worker } = await import(process.env.DF_TEST_WORKER_URL || '../static/_worker.js');

const games = { games_per_set: 1, sets_to_win: 1, tiebreak_at: 1 };
const fixture = (name = 'A') => ({
  id: 'm_' + randomUUID(), sport: 'padel', mode: 'singles', rules: games,
  team_a_name: name, team_b_name: 'B',
  team_a_players: [{ id: 'a', name }], team_b_players: [{ id: 'b', name: 'B' }]
});

function client(env, initialCookie = '') {
  let cookie = initialCookie;
  return async (path, method = 'GET', body) => {
    const response = await worker.fetch(new Request('https://scoring.test/api/' + path, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), env);
    if (response.headers.has('Set-Cookie')) cookie = response.headers.get('Set-Cookie').split(';')[0];
    if (response.headers.get('Content-Type')?.startsWith('text/csv')) {
      return { statusCode: response.status, csv: await response.text() };
    }
    return { statusCode: response.status, ...(await response.json()) };
  };
}

async function googleMember(env, name = 'Member') {
  await ensureSchema(env.DF_SCORING_DB);
  const token = randomToken(32);
  const user = { id: randomUUID(), role: 'member', provider: 'google_oauth', name, email: name + '@gmail.com' };
  await env.DF_SCORING_DB.prepare('INSERT INTO df_sessions VALUES (?, ?, ?, ?)')
    .bind(await digest(token), user.id, Date.now() + 86400000, JSON.stringify(user)).run();
  return client(env, 'df_session_v2=' + token);
}

test('two admins share all courts, guard stale scores and release a court exactly once', async t => {
  const db = localD1();
  t.after(() => db.close());
  const password = randomUUID();
  const env = {
    DF_SCORING_DB: db, DF_ADMIN_PASSWORD: password,
    DF_SCORING_KV: {
      get: async key => ({
        courts: [{ id: 'court_3', active_match: fixture('Legacy placeholder') }],
        players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        matches: [{ id: 'old', team_a_name: 'Historic match' }]
      })[key] ?? null
    }
  };
  const a = client(env), b = client(env), member = await googleMember(env), anonymous = client(env);
  assert.equal((await anonymous('admin/backup')).statusCode, 403);
  const first = await a('bootstrap');
  assert.equal(first.courts.length, 3);
  assert(first.courts.every(court => court.active_match === null));
  assert.equal(first.matches[0].id, 'old');
  const logins = await Promise.all([
    a('auth/login', 'POST', { role: 'admin', password, name: 'Admin A' }),
    b('auth/login', 'POST', { role: 'admin', password, name: 'Admin B' })
  ]);
  assert(logins.every(login => login.statusCode === 200), JSON.stringify(logins));
  assert.notEqual(logins[0].user.id, logins[1].user.id);
  assert.equal((await member('admin/backup')).statusCode, 403);
  assert.equal((await a('bootstrap')).users.length, 2);
  assert.equal((await b('bootstrap')).users.length, 2);
  assert.equal((await member('bootstrap')).users.length, 0);
  assert.equal((await anonymous('courts/court_3/start', 'POST', fixture())).statusCode, 401);

  const results = await Promise.all([
    a('courts/court_3/start', 'POST', fixture()), b('courts/court_3/start', 'POST', fixture('C'))
  ]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  let active = results.find(result => result.statusCode === 200).court.active_match;
  const started = await b('live');
  assert.equal(started.courts[2].active_match.id, active.id);
  assert.equal(started.courts[2].active_match.team_a_name, active.team_a_name);
  assert.equal((await b('live?since=' + started.revision)).courts, undefined);
  assert.equal((await member('courts/court_3/clear', 'POST', {})).statusCode, 403);
  assert.equal((await a('courts/court_4/start', 'POST', fixture())).statusCode, 404);
  assert.equal((await b('courts/court_1/start', 'POST', fixture('Other'))).statusCode, 200);

  const score = (api, action, match = active) => api('courts/court_3/score', 'POST',
    { match_id: match.id, version: match.version, action });
  const points = await Promise.all([
    score(a, { type: 'point', team: 'team_a' }), score(b, { type: 'point', team: 'team_a' })
  ]);
  assert.deepEqual(points.map(result => result.statusCode).sort(), [200, 409]);
  active = (await member('live')).courts[2].active_match;
  assert.equal(active.display_point_a, '15');
  assert.equal(active.undo_count, 1);
  const undone = await score(b, { type: 'undo' });
  assert.equal(String(undone.court.active_match.display_point_a), '0');
  active = undone.court.active_match;
  const redone = await score(a, { type: 'redo' });
  active = redone.court.active_match;
  assert.equal(active.display_point_a, '15');
  const finish = { match_id: active.id, version: active.version, winner: 'team_a' };
  assert.equal((await a('courts/court_3/finish', 'POST', { ...finish, winner: '' })).statusCode, 400);
  const finished = await Promise.all([
    a('courts/court_3/finish', 'POST', finish), b('courts/court_3/finish', 'POST', finish)
  ]);
  assert(finished.every(result => result.statusCode === 200 && result.court.active_match === null));
  const after = await b('bootstrap');
  assert.equal(after.matches.filter(match => match.id === active.id).length, 1);
  assert.equal(after.players.find(player => player.id === 'a').matches_won, 1);
  assert.equal(after.courts[2].active_match, null);
  assert(after.courts[0].active_match);
  assert.equal((await score(a, { type: 'point', team: 'team_a' })).statusCode, 409);
  assert.equal((await b('courts/court_3/start', 'POST', fixture('Next'))).statusCode, 200);
  assert.equal((await a('auth/logout', 'POST', {})).statusCode, 200);
  assert.equal((await a('auth/session')).user, null);
});

test('knockout byes, doubles round robin, cross-court fixture lock and atomic result', async t => {
  const db = localD1();
  t.after(() => db.close());
  const password = randomUUID();
  const api = client({ DF_SCORING_DB: db, DF_ADMIN_PASSWORD: password });
  assert.equal((await api('auth/login', 'POST', { role: 'admin', password })).statusCode, 200);
  const players = Array.from({ length: 5 }, (_, index) => ({ id: 'p' + index, name: 'Pemain ' + index }));
  const draft = TournamentManager.createKnockoutTournament('Gugur', 'padel', 'singles', players, games);
  const tourney = await api('tournaments', 'POST', { ...draft, password: randomUUID() });
  assert.equal(tourney.statusCode, 200);
  const opening = tourney.rounds[0].matches.find(TournamentManager.isPlayable);
  assert(opening);
  assert.equal(tourney.rounds[0].matches.filter(match => match.score_display === 'BYE').length, 3);

  const launch = () => ({
    ...fixture(), tournament_id: tourney.id, tournament_match_id: opening.id
  });
  const results = await Promise.all([
    api('courts/court_1/start', 'POST', launch()), api('courts/court_2/start', 'POST', launch())
  ]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  let { id: courtId, active_match: match } = results.find(result => result.statusCode === 200).court;
  for (let point = 0; point < 4; point++) {
    const result = await api('courts/' + courtId + '/score', 'POST', {
      match_id: match.id, version: match.version, action: { type: 'point', team: 'team_a' }
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result));
    match = result.court.active_match;
  }
  assert.equal(match.is_completed, true);
  assert.equal(match.winner, 'team_a');
  const result = await api('courts/' + courtId + '/finish', 'POST', { match_id: match.id, version: match.version });
  assert.equal(result.statusCode, 200);
  const bootstrap = await api('bootstrap');
  const updated = bootstrap.tournaments.find(item => item.id === tourney.id);
  assert.equal(TournamentManager.findMatch(updated, opening.id).winner, 'team_a');
  assert(updated.rounds[1].matches.some(item => item.team_a?.id === opening.team_a.id || item.team_b?.id === opening.team_a.id));
  assert.equal(bootstrap.courts.find(court => court.id === courtId).active_match, null);
  assert.equal(bootstrap.matches[0].id, match.id);

  const doubles = [0, 1, 2].map(index => ({
    id: 'team_' + index, name: 'Tim ' + index, mode: 'doubles',
    players: [{ id: 'a' + index, name: 'A ' + index }, { id: 'b' + index, name: 'B ' + index }]
  }));
  const robin = await api('tournaments', 'POST',
    { ...TournamentManager.createRoundRobinTournament('Round Robin', 'tennis', 'doubles', doubles, games), password: randomUUID() });
  assert.equal(robin.statusCode, 200);
  const schedule = robin.rounds.flatMap(round => round.matches);
  assert.equal(schedule.length, 3);
  for (const game of schedule) {
    const walkover = await api('matches', 'POST', {
      tournament_id: robin.id, tournament_match_id: game.id, court_id: 'court_3',
      winner: 'team_a', win_type: 'walkover', win_reason: 'W.O.'
    });
    assert.equal(walkover.statusCode, 200);
  }
  const rr = (await api('bootstrap')).tournaments.find(item => item.id === robin.id);
  assert.equal(rr.status, 'completed');
  assert.equal(TournamentManager.calculateStandings(rr)[0].played, 2);
  assert(rr.champion_name);
});

test('email login and registration are disabled, including old member sessions', async t => {
  const db = localD1(':memory:', { initialize: false });
  t.after(() => db.close());
  const env = { DF_SCORING_DB: db };
  const api = client(env);
  assert.equal((await api('bootstrap')).statusCode, 200);
  for (const action of ['login', 'register']) {
    assert.equal((await api('auth/' + action, 'POST', { email: 'member@gmail.com', password: randomUUID() })).statusCode, 403);
  }
  assert.equal((await api('auth/login', 'POST', { role: 'admin', password: randomUUID() })).statusCode, 503);
  const token = randomToken(32);
  await db.prepare('INSERT INTO df_sessions VALUES (?, ?, ?, ?)').bind(await digest(token), 'old-member', Date.now()+100000,
    JSON.stringify({id:'old-member', role:'member', provider:'email_password'})).run();
  assert.equal((await client(env, 'df_session_v2='+token)('auth/session')).user, null);
  const missing = await worker.fetch(new Request('https://scoring.test/api/bootstrap'), {});
  assert.equal(missing.status, 503);
});

test('Google verifies the issuer, audience, expiry, email and signature and reuses the Google subject', async t => {
  const db = localD1();
  t.after(() => db.close());
  const clientId = 'test-scoring.apps.googleusercontent.com';
  const api = client({ DF_SCORING_DB: db, GOOGLE_CLIENT_ID: clientId });
  const keys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const fetchOriginal = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetchOriginal; });
  let keyId = 'test-key';
  let failures = 1;
  let keyRequests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual', 'Workers rejects the error redirect mode before sending a request');
    keyRequests++;
    if (failures-- > 0) throw new Error('temporary key service outage');
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    return Response.json({ keys: [{ ...publicKey, kid: keyId }] }, { headers: { 'Cache-Control': 'max-age=60' } });
  };
  const now = Math.floor(Date.now() / 1000);
  async function token(overrides = {}, corrupt = false) {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: clientId, sub: 'stable-google-subject',
      iat: now, exp: now + 3600, email_verified: true, email: 'google@gmail.com',
      name: 'Google Player', ...overrides
    })).toString('base64url');
    const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, Buffer.from(head + '.' + payload)));
    if (corrupt) signature[0] ^= 1;
    return head + '.' + payload + '.' + signature.toString('base64url');
  }
  for (const credential of [
    await token({}, true),
    await token({ iss: 'https://example.test' }),
    await token({ aud: 'different.apps.googleusercontent.com' }),
    await token({ exp: now - 1 }),
    await token({ email_verified: false })
  ]) assert.equal((await api('auth/google', 'POST', { credential })).statusCode, 401);

  assert.equal((await api('auth/google', 'POST', { credential: await token() })).requires_password, true);
  assert.equal((await api('auth/session')).user, null);
  assert.equal((await api('auth/google', 'POST', { credential: await token({email:'other@example.test'}), password: randomUUID() })).statusCode, 403);
  const first = await api('auth/google', 'POST', { credential: await token(), role: 'admin', password: randomUUID() });
  assert.equal(first.statusCode, 200);
  assert.equal(first.user.role, 'member');
  assert.equal(first.user.email, 'google@gmail.com');
  assert.equal((await api('bootstrap')).settings.google_client_id, clientId);
  const again = await api('auth/google', 'POST', { credential: await token({ name: 'Updated' }) });
  assert.equal(again.user.id, first.user.id);
  assert.equal(again.user.name, 'Updated');
  assert.equal((await api('admin/backup')).statusCode, 403);
  assert.equal(keyRequests, 2, 'retry temporary key fetch failure and reuse cache');
  keyId = 'rotated-key';
  assert.equal((await api('auth/google', 'POST', { credential: await token() })).statusCode, 200);
  assert.equal(keyRequests, 3, 'refresh cached keys for a newly rotated kid');
});

test('admin can manage shared players, verify Sheets, export and restore data', async t => {
  const db = localD1();
  t.after(() => db.close());
  const password = randomUUID();
  const api = client({ DF_SCORING_DB: db, DF_ADMIN_PASSWORD: password });
  assert.equal((await api('auth/login', 'POST', { role: 'admin', password })).statusCode, 200);
  const player = await api('players', 'POST', { name: 'Audit Player', handedness: 'Kidal' });
  assert(player.id);
  assert.equal((await api('players/' + player.id, 'PUT', { level: 'Advanced' })).level, 'Advanced');
  const url = 'https://script.google.com/macros/s/test-deployment/exec';
  assert.equal((await api('settings', 'POST', { google_sheet_url: url })).google_sheet_url, url);
  const fetchOriginal = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetchOriginal; });
  const sent = [];
  globalThis.fetch = async (destination, request) => {
    assert.equal(String(destination), url);
    const payload = JSON.parse(request.body);
    sent.push(payload.type);
    return Response.json({ status: payload.type === 'ping' ? 'error' : 'success' });
  };
  assert.equal((await api('test-sheet-connection', 'POST', { google_sheet_url: url })).statusCode, 502);
  assert.equal((await api('sync-sheets', 'POST', {})).synced_count, 0);
  assert.deepEqual(sent, ['ping', 'bulk_sync']);
  const report = await api('export/csv');
  assert.equal(report.statusCode, 200);
  assert(report.csv.includes('ID Pertandingan'));
  const backup = await api('admin/backup');
  assert.equal(backup.players[0].name, 'Audit Player');
  assert.equal(backup.users[0].role, 'admin');
  assert(!JSON.stringify(backup).includes(password));
  assert.equal((await api('players/' + player.id, 'DELETE')).status, 'deleted');
  assert.equal((await api('admin/restore', 'POST', { players: backup.players })).status, 'success');
  assert.equal((await api('bootstrap')).players[0].id, player.id);
});
