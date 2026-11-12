/**
 * DF Scoring PRO — Main Application Logic (v3.0)
 * Shared Courtside Scoring, Google Member & Admin Authentication,
 * Comprehensive Admin Command Center, Multi-Court Live Sync, Tournament Engine & Google Sheets.
 */

const DEFAULT_COURTS = ['court_1', 'court_2', 'court_3'].map((id, index) => ({
  id, name: `Lapangan ${index + 1}`, active_match: null
}));

function canRefereeMatch(id, fixtureId) {
  return AppState.currentUser?.role === 'admin' || Boolean(AppState.currentUser && AppState.refereeMatches?.some(grant => grant.tournament_id === id && grant.fixture_id === fixtureId));
}

function replayButton(tournamentId, fixtureId) {
  return `<button onclick="replayTournamentMatch(${htmlArgument(tournamentId)}, ${htmlArgument(fixtureId)})" class="w-full py-2 bg-blue-700 rounded-xl text-xs font-bold">↻ Ulangi Pertandingan</button>`;
}

async function replayTournamentMatch(tournamentId, fixtureId) {
  if (!AppState.currentUser) return;
  const password = await requestPassword('Ulangi Pertandingan', 'Masukkan password turnamen. Skor match dimulai dari 0–0; hasil sebelumnya ditandai di riwayat.');
  if (password === null) return;
  const courtId = await chooseAvailableCourt();
  if (!courtId) return;
  const response = await apiPost(`/api/tournaments/${tournamentId}/replay`, { password, fixture_id: fixtureId, court_id: courtId });
  if (!response?.court || response.error) return showToast(response?.error || 'Match gagal diulang.');
  await fetchBootstrapData();
  document.getElementById('bracket-modal').classList.add('hidden');
  handleCourtSwitch(courtId); switchTab('scorer');
  showToast('Pertandingan diulang dari 0–0.');
}

function playScoringPlayerSlogan(team, index) {
  if (!canScoreMatch()) return;
  const player = AppState.scorer?.[team]?.players?.[index];
  if (!player) return;
  const profile = AppState.players.find(item => item.id === player.id)
    || AppState.players.find(item => item.name === player.name) || player;
  window.soundEngine.playPlayerSloganNow(profile);
}

function canScoreMatch(match = AppState.courts.find(court => court.id === AppState.currentCourtId)?.active_match) {
  if (!match || !AppState.currentUser) return false;
  return match.tournament_id ? canRefereeMatch(match.tournament_id, match.tournament_match_id)
    : AppState.currentUser.role === 'admin' || match.referee_user_id === AppState.currentUser.id;
}

function syncAccessUI() {
  const admin = AppState.currentUser?.role === 'admin';
  const allowed = canScoreMatch();
  document.querySelectorAll('[onclick^="openPlayerModal"], [onclick^="editPlayer"], [onclick^="deletePlayer"]').forEach(el => { el.hidden = !admin; });
  const actions = /^(handlePoint|handleUndo|handleRedo|handleToggleServer|handleSelectDoublesServer|handleToggleGoldenPoint|openQuickTargetGamesModal|openWalkoverModal|handleResetCurrentMatch|showMatchCompletedModal|handleDismissSideSwitch)\(/;
  document.querySelectorAll('#active-scoreboard button[onclick]').forEach(el => {
    if (actions.test(el.getAttribute('onclick'))) el.hidden = !allowed;
  });
  const active = AppState.courts.find(court => court.id === AppState.currentCourtId)?.active_match;
  document.getElementById('spectator-label')?.classList.toggle('hidden', !active || allowed);
  document.getElementById('cancel-match-button')?.classList.toggle('hidden', !active || !allowed);
  document.getElementById('unlock-referee-button')?.classList.toggle('hidden', !active?.tournament_id || allowed);
}

// Native dialogs sit above both bracket and swap overlays and keep keyboard focus inside.
function inputDialog(title, description, makeInput) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'input-dialog';
    const form = document.createElement('form');
    const heading = document.createElement('h2');
    heading.id = 'input-dialog-title'; heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id);
    const text = document.createElement('p'); text.textContent = description;
    const input = makeInput(); input.required = true;
    input.setAttribute('aria-label', title);
    const error = document.createElement('p'); error.setAttribute('role', 'alert');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Batal';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Lanjutkan';
    form.append(heading, text, input, error, cancel, submit); dialog.append(form); document.body.append(dialog);
    const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
    cancel.onclick = () => finish(null);
    dialog.oncancel = event => { event.preventDefault(); finish(null); };
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) finish(input.value); };
    dialog.showModal(); input.focus();
  });
}

function requestPassword(title, description) {
  return inputDialog(title, description, () => {
    const input = document.createElement('input'); input.type = 'password'; input.minLength = 8; input.maxLength = 128;
    input.autocomplete = title.startsWith('Create') ? 'new-password' : 'current-password';
    return input;
  });
}

async function chooseAvailableCourt() {
  await pollSharedState();
  const available = AppState.courts.filter(court => !court.active_match);
  if (!available.length) { showToast('Semua lapangan sedang dipakai.'); return null; }
  return inputDialog('Pilih Lapangan', 'Hanya lapangan yang tersedia yang dapat dipilih.', () => {
    const select = document.createElement('select');
    available.forEach(court => select.add(new Option(court.name, court.id)));
    return select;
  });
}

async function ensureReferee(id, fixtureId) {
  if (canRefereeMatch(id, fixtureId)) return true;
  if (!AppState.currentUser) { document.getElementById('auth-gate-modal').classList.remove('hidden'); return false; }
  const password = await requestPassword('Password Turnamen', 'Masukkan password turnamen untuk menjadi wasit pada match ini saja.');
  if (password === null) return false;
  const response = await apiPost(`/api/tournaments/${id}/unlock`, { password, fixture_id: fixtureId });
  if (response?.status !== 'success') { showToast(response?.error || 'Gagal membuka akses wasit.'); return false; }
  await fetchBootstrapData(); syncAccessUI();
  showToast('Akses wasit aktif untuk match ini.');
  return true;
}

function unlockCurrentMatch() {
  const active = AppState.courts.find(court => court.id === AppState.currentCourtId)?.active_match;
  if (active?.tournament_id) return ensureReferee(active.tournament_id, active.tournament_match_id);
}

async function setTournamentPassword() {
  const id = AppState.selectedTournament?.id;
  if (!id || AppState.currentUser?.role !== 'admin') return;
  const password = await requestPassword('Create Password Turnamen', 'Wasit perlu memasukkan password baru setelah password diganti.');
  if (password === null) return;
  const response = await apiPost(`/api/tournaments/${id}/password`, { password });
  if (response?.error) return showToast(response.error);
  await fetchBootstrapData(); showToast('Password turnamen disimpan.');
}

async function cancelCurrentMatch() {
  const match = AppState.scorer;
  if (!match || !canScoreMatch() || !confirm('Batalkan pertandingan dan kosongkan lapangan? Skor pertandingan aktif akan dibuang.')) return;
  await runCourtRequest(match.court_id, 'cancel', { match_id: match.id, version: match.version });
}

async function resumeMatch(id) {
  const match = AppState.matches.find(item => item.id === id);
  if (!match) return;
  if (match.tournament_id && !await ensureReferee(match.tournament_id, match.tournament_match_id)) return;
  const courtId = await chooseAvailableCourt();
  if (!courtId) return;
  const response = await apiPost(`/api/matches/${id}/resume`, { court_id: courtId });
  if (!response?.court || response.error) return showToast(response?.error || 'Pertandingan gagal dilanjutkan.');
  await fetchBootstrapData();
  handleCourtSwitch(courtId); switchTab('scorer');
  showToast('Pertandingan dilanjutkan dari skor terakhir.');
}

function applyHeaderState() {
  const minimized = localStorage.getItem('df_header_minimized') === 'true';
  document.getElementById('app-header').classList.toggle('minimized', minimized);
  const button = document.getElementById('toggle-header');
  button.setAttribute('aria-expanded', String(!minimized));
  button.setAttribute('aria-label', minimized ? 'Maximize navigasi' : 'Minimize navigasi');
  button.textContent = minimized ? '⌄ Maximize navigasi' : '⌃ Minimize navigasi';
}

function toggleHeader() {
  localStorage.setItem('df_header_minimized', String(!document.getElementById('app-header').classList.contains('minimized')));
  applyHeaderState();
}

function tournamentWithLiveScores(tournament) {
  const copy = structuredClone(tournament);
  for (const fixture of copy.rounds.flatMap(round => round.matches)) {
    const court = AppState.courts.find(item => item.active_match?.tournament_id === copy.id
      && item.active_match.tournament_match_id === fixture.id);
    if (!court) continue;
    const match = court.active_match;
    fixture.status = 'on play';
    fixture.score_display = [court.name, (match.sets_history || []).map(set => `${set.team_a}-${set.team_b}`).join(' | '), `Game ${match.current_set_games.team_a}-${match.current_set_games.team_b}`, `Poin ${match.display_point_a}-${match.display_point_b}`].filter(Boolean).join(' · ');
  }
  return copy;
}

function downloadTournamentBracket() {
  if (!AppState.selectedTournament) return;
  const tournament = tournamentWithLiveScores(AppState.selectedTournament);
  const standings = tournament.format === 'round_robin' ? `<h2>Klasemen</h2><table><tr><th>Peserta</th><th>Main</th><th>Menang</th><th>Poin</th></tr>${TournamentManager.calculateStandings(tournament).map(row => `<tr><td>${escapeHTML(row.participant.name)}</td><td>${row.played}</td><td>${row.won}</td><td>${row.points}</td></tr>`).join('')}</table>` : '';
  const rounds = tournament.rounds.map(round => `<section><h2>${escapeHTML(round.name)}</h2>${round.matches.map(match => `<details open data-match><summary>${escapeHTML(match.team_a?.name || 'Menunggu')} vs ${escapeHTML(match.team_b?.name || 'Menunggu')}</summary><p class="status">${escapeHTML(match.status.toUpperCase())}</p><p>${escapeHTML(match.score_display || 'vs')}</p>${match.winner_participant ? `<p class="winner">🏆 ${escapeHTML(match.winner_participant.name)}</p>` : ''}</details>`).join('')}</section>`).join('');
  const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(tournament.name)}</title><style>body{font:16px system-ui;background:#0b1220;color:#e2e8f0;max-width:1400px;margin:auto;padding:24px}h1,.winner{color:#34d399}.rounds{display:flex;gap:24px;overflow:auto}section{min-width:290px;flex:1}details{background:#172033;border:1px solid #334155;border-radius:16px;padding:18px;margin:16px 0}summary{cursor:pointer;font-weight:bold}.status{font-size:12px;color:#fbbf24}input,button{padding:12px;border-radius:8px;margin:8px 4px}table{border-collapse:collapse}td,th{padding:10px;border:1px solid #334155}@media print{body{background:white;color:black}button,input{display:none}.rounds{display:block}details{break-inside:avoid;background:white}}</style><h1>${escapeHTML(tournament.name)}</h1><p>Snapshot ${escapeHTML(new Date().toLocaleString('id-ID', {timeZone:'Asia/Jakarta'}))} WIB · Skor saat diunduh; buka aplikasi untuk pembaruan live.</p><p>${escapeHTML(tournament.champion_name ? 'Juara: ' + tournament.champion_name : 'Turnamen berlangsung')}</p><input type="search" aria-label="Cari peserta" placeholder="Cari peserta…" oninput="document.querySelectorAll('[data-match]').forEach(m=>m.hidden=!m.textContent.toLowerCase().includes(this.value.toLowerCase()))"><button onclick="print()">Cetak / Simpan PDF</button>${standings}<div class="rounds">${rounds}</div></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `${tournament.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}-bagan.html`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const AppState = {
  currentTab: 'scorer',
  currentCourtId: DEFAULT_COURTS.some(court => court.id === localStorage.getItem('padel_active_court_id'))
    ? localStorage.getItem('padel_active_court_id') : 'court_1',
  currentUser: null, // { id, name, email, picture, role: 'admin' | 'member', court_id, player_id }
  loginSelectedRole: 'member',
  memberAuthMode: 'login',

  scorer: null,
  players: [],
  tournaments: [],
  matches: [],
  courts: DEFAULT_COURTS,
  users: [],
  settings: {},
  systemInfo: {},
  selectedTournament: null,

  matchDurationSecs: 0,
  tourneyDoublesTeams: [],
  finishContext: null,
  courtRevision: -1,
  courtAcknowledgements: new Map(),
  dataRevision: -1,
  bootstrapPromise: null,
  polling: false,
  pendingCourtAction: false,

  // Dirty-check hashes for zero-lag DOM updates
  lastHeaderHashA: '',
  lastHeaderHashB: '',
  lastPointA: '',
  lastPointB: '',

  // Voice Slogan Recording
  mediaRecorder: null,
  audioChunks: [],
  isRecordingVoice: false,
  recordTimerInterval: null,
  recordDurationSecs: 0,
  lastWinnerData: null,

  // Screen Wake Lock for courtside phones
  wakeLock: null
};

// ============================================================================
// 1. INSTANT BOOTSTRAP & ZERO-LAG INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  applyHeaderState();
  populateCourtDropdowns();
  if (localStorage.getItem('sunlight_mode') === 'true') document.body.classList.add('sunlight-mode');
  startMatchTimer();
  updateScoreboardUI(true);

  await Promise.all([initAuthSession(), fetchBootstrapData()]);
  requestCourtWakeLock();
  setInterval(() => { if (!document.hidden) pollSharedState(); }, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollSharedState(); });
});

async function fetchBootstrapData() {
  if (AppState.bootstrapPromise) return AppState.bootstrapPromise;
  AppState.bootstrapPromise = (async () => {
    const data = await apiGet('/api/bootstrap', true);
    if (!data || data.error) {
      showAuthMessage('auth-service-message', data?.error || 'Server DF Scoring tidak terjangkau. Coba muat ulang halaman.');
      document.getElementById('google-login-status').textContent = 'Masuk Google menunggu koneksi ke server.';
      setSyncIndicator('offline');
      return false;
    }
    showAuthMessage('auth-service-message');
    if (data.data_revision >= AppState.dataRevision) {
      const oldClientId = AppState.settings.google_client_id;
      AppState.dataRevision = data.data_revision;
      AppState.systemInfo = data.info;
      AppState.settings = data.settings;
      AppState.players = data.players;
      AppState.tournaments = data.tournaments;
      AppState.matches = data.matches;
      AppState.users = data.users;
      AppState.refereeMatches = data.referee_matches || [];
      syncAccessUI();
      window.soundEngine.setVoiceLang(data.settings.voice_lang || 'id-ID');
      const localSound = localStorage.getItem('df_sound_enabled');
      window.soundEngine.setSoundEnabled(localSound === null ? data.settings.sound_enabled : localSound === 'true');
      updateSoundIcon();
      if (!AppState.currentUser) populateLoginPlayerPicker();
      if (oldClientId !== data.settings.google_client_id || !AppState.currentUser) initGoogleIdentityClient();
      renderSharedData();
    }
    applyCourtSnapshot(data);
    setSyncIndicator('online');
    return true;
  })();
  try {
    return await AppState.bootstrapPromise;
  } finally {
    AppState.bootstrapPromise = null;
  }
}

function renderSharedData() {
  if (AppState.currentTab === 'players') renderPlayersTab();
  if (AppState.currentTab === 'history') renderHistoryTab();
  if (AppState.currentTab === 'tournaments') renderTournamentsList();
  if (AppState.currentTab === 'admin') renderAdminDashboard();
  const bracket = document.getElementById('bracket-modal');
  if (AppState.selectedTournament && !bracket.classList.contains('hidden')) {
    const current = AppState.tournaments.find(tournament => tournament.id === AppState.selectedTournament.id);
    if (current) viewTournamentBracket(current.id);
    else bracket.classList.add('hidden');
  }
}

async function pollSharedState() {
  if (AppState.polling) return;
  AppState.polling = true;
  try {
    const state = await apiGet(`/api/live?since=${AppState.courtRevision}`);
    if (!state) {
      setSyncIndicator('offline');
      return;
    }
    if (state.courts) applyCourtSnapshot(state);
    if (state.data_revision > AppState.dataRevision) await fetchBootstrapData();
    else setSyncIndicator('online');
  } finally {
    AppState.polling = false;
  }
}

function setSyncIndicator(state) {
  const dot = document.getElementById('sync-status-dot');
  if (!dot) return;
  if (state === 'syncing') {
    dot.className = 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-950 text-amber-400 border border-amber-500/30';
    dot.textContent = '↻ SYNC';
  } else if (state === 'offline') {
    dot.className = 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700';
    dot.textContent = '○ TERPUTUS';
  } else {
    dot.className = 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/30';
    dot.textContent = '● LIVE';
  }
}

async function requestCourtWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      AppState.wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
          try {
            AppState.wakeLock = await navigator.wakeLock.request('screen');
          } catch (e) {}
        }
      });
    }
  } catch (e) {}
}

function toggleFullscreenMode() {
  try {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      showToast('Mode Layar Penuh (TV / Tablet) Aktif');
    } else {
      document.exitFullscreen();
      showToast('Keluar dari Mode Layar Penuh');
    }
  } catch (e) {
    showToast('Browser tidak mendukung Fullscreen otomatis');
  }
}

// ============================================================================
// 2. AUTHENTICATION & ROLE SYSTEM (MEMBER GOOGLE vs ADMIN 1..10)
// ============================================================================
async function initAuthSession() {
  const session = await apiGet('/api/auth/session');
  if (AppState.currentUser) return;
  AppState.currentUser = session?.user || null;
  if (AppState.currentUser) {
    applyLoggedInUserUI();
    document.getElementById('auth-gate-modal').classList.add('hidden');
  } else {
    document.getElementById('auth-gate-modal').classList.remove('hidden');
    selectLoginRole('member');
  }
}

function selectLoginRole(role) {
  AppState.loginSelectedRole = role;
  const tabMember = document.getElementById('role-tab-member');
  const tabAdmin = document.getElementById('role-tab-admin');
  const panelMember = document.getElementById('login-panel-member');
  const panelAdmin = document.getElementById('login-panel-admin');

  if (role === 'admin') {
    if (tabAdmin) tabAdmin.className = 'py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex flex-col items-center justify-center space-y-1 transition bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg';
    if (tabMember) tabMember.className = 'py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex flex-col items-center justify-center space-y-1 transition text-slate-400 hover:text-white hover:bg-slate-800/60';
    if (panelAdmin) panelAdmin.classList.remove('hidden');
    if (panelMember) panelMember.classList.add('hidden');
    setTimeout(() => document.getElementById('admin-login-password')?.focus(), 80);
  } else {
    if (tabMember) tabMember.className = 'py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex flex-col items-center justify-center space-y-1 transition bg-emerald-600 text-white shadow-lg';
    if (tabAdmin) tabAdmin.className = 'py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex flex-col items-center justify-center space-y-1 transition text-slate-400 hover:text-white hover:bg-slate-800/60';
    if (panelMember) panelMember.classList.remove('hidden');
    if (panelAdmin) panelAdmin.classList.add('hidden');
  }
}

function toggleAdminPasswordVisibility() {
  const input = document.getElementById('admin-login-password');
  const btn = document.getElementById('btn-toggle-pwd-vis');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈 Sembunyikan';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️ Lihat Password';
  }
}

function populateLoginPlayerPicker() {
  const sel = document.getElementById('member-login-player-link');
  if (!sel) return;
  const opts = (AppState.players || []).map(p =>
    `<option value="${escapeHTML(p.id)}" data-name="${escapeHTML(p.name)}">${escapeHTML(p.name)} (${escapeHTML(p.level || 'Member')})</option>`
  ).join('');
  sel.innerHTML = `<option value="">-- Pilih dari Daftar Pemain (Opsional) --</option>` + opts;
}

function showAuthMessage(id, message = '') {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function memberLoginOptions() {
  return {
    court_id: document.getElementById('member-login-court').value || AppState.currentCourtId,
    player_id: document.getElementById('member-login-player-link').value || null
  };
}

let googleScript;
let renderedGoogleClientId = '';
async function initGoogleIdentityClient() {
  const clientId = AppState.settings.google_client_id;
  const container = document.getElementById('google-gsi-button-wrap');
  const status = document.getElementById('google-login-status');
  if (!clientId) {
    renderedGoogleClientId = '';
    container.replaceChildren();
    container.classList.add('hidden');
    status.classList.remove('hidden');
    status.textContent = 'Masuk Google belum diaktifkan. Hubungi admin untuk menyiapkan Google Client ID.';
    return;
  }
  if (renderedGoogleClientId === clientId) return;
  status.textContent = 'Memuat tombol Google…';
  status.classList.remove('hidden');

  if (!window.google?.accounts?.id && !googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('Google Identity Services unavailable'));
      };
      document.head.append(script);
    });
  }
  try {
    await googleScript;
    if (clientId !== AppState.settings.google_client_id || renderedGoogleClientId === clientId) return;
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredentialResponse });
    container.replaceChildren();
    container.classList.remove('hidden');
    const width = Math.max(200, Math.min(320, container.clientWidth || 280));
    window.google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', width, text: 'continue_with' });
    renderedGoogleClientId = clientId;
    status.classList.add('hidden');
  } catch {
    googleScript = null;
    renderedGoogleClientId = '';
    container.classList.add('hidden');
    status.textContent = 'Tombol Google gagal dimuat. Muat ulang halaman untuk mencoba lagi.';
  }
}

async function handleGoogleCredentialResponse(response) {
  if (!response?.credential) {
    showAuthMessage('member-login-error', 'Google tidak mengirim sesi login. Pilih akun Google lagi.');
    return;
  }
  await completeUserLogin('google', { ...memberLoginOptions(), credential: response.credential }, 'member-login-error');
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const password = document.getElementById('admin-login-password');
  const user = await completeUserLogin('login', {
    name: document.getElementById('admin-login-name').value.trim(),
    role: 'admin',
    password: password.value,
    court_id: AppState.currentCourtId
  }, 'admin-login-error', event.currentTarget.querySelector('[type="submit"]'));
  if (user) password.value = '';
}

let loginInProgress = false;
async function completeUserLogin(action, payload, feedback, button) {
  if (loginInProgress) return null;
  loginInProgress = true;
  if (button) button.disabled = true;
  showAuthMessage(feedback);
  try {
    let response = await apiPost('/api/auth/' + action, payload);
    if (response?.requires_password && action === 'google') {
      const password = await requestPassword('Create Password', 'Buat password akun minimal 8 karakter. Anda tetap wajib login melalui Google.');
      if (password === null) return null;
      response = await apiPost('/api/auth/google', { ...payload, password });
    }
    if (!response?.user) {
      showAuthMessage(feedback, response?.error || response?.message || 'Koneksi ke server gagal. Coba lagi.');
      return null;
    }
    AppState.currentUser = response.user;
    AppState.dataRevision = -1;
    applyLoggedInUserUI();
    document.getElementById('auth-gate-modal').classList.add('hidden');
    document.getElementById('modal-user-account').classList.add('hidden');
    handleCourtSwitch(response.user.court_id);
    switchTab(response.user.role === 'admin' ? 'admin' : 'scorer');
    await fetchBootstrapData();
    if (action === 'register') showToast('Akun berhasil dibuat.');
    return response.user;
  } finally {
    loginInProgress = false;
    if (button) button.disabled = false;
  }
}

function applyLoggedInUserUI() {
  const u = AppState.currentUser;
  syncAccessUI();
  if (!u) return;

  const avatarEl = document.getElementById('header-user-avatar');
  const nameEl = document.getElementById('header-user-name');
  const roleEl = document.getElementById('header-user-role');
  const adminNavBtn = document.getElementById('nav-btn-admin');

  if (avatarEl) avatarEl.src = u.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.name)}`;
  if (nameEl) nameEl.textContent = u.name;
  if (roleEl) {
    if (u.role === 'admin') {
      roleEl.textContent = '🛡️ ADMIN';
      roleEl.className = 'text-[9px] font-black uppercase text-blue-400 leading-tight';
    } else {
      roleEl.textContent = '👤 MEMBER';
      roleEl.className = 'text-[9px] font-black uppercase text-emerald-400 leading-tight';
    }
  }

  if (adminNavBtn) {
    if (u.role === 'admin') {
      adminNavBtn.classList.remove('opacity-75');
    } else {
      adminNavBtn.classList.add('opacity-75');
    }
  }
}

function openUserAccountModal() {
  const u = AppState.currentUser;
  if (!u) {
    document.getElementById('auth-gate-modal').classList.remove('hidden');
    return;
  }

  document.getElementById('account-modal-avatar').src = u.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.name)}`;
  document.getElementById('account-modal-name').textContent = u.name;
  document.getElementById('account-modal-email').textContent = u.email || '-';

  const badge = document.getElementById('account-modal-role-badge');
  const upgradeBox = document.getElementById('account-upgrade-admin-box');

  if (u.role === 'admin') {
    badge.textContent = '🛡️ ADMIN UTAMA';
    badge.className = 'px-2 py-0.5 rounded text-[10px] font-black uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40';
    if (upgradeBox) upgradeBox.classList.add('hidden');
  } else {
    badge.textContent = '👤 MEMBER / WASIT';
    badge.className = 'px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    if (upgradeBox) upgradeBox.classList.remove('hidden');
  }

  const pwdInput = document.getElementById('quick-admin-pwd-input');
  if (pwdInput) pwdInput.value = '';
  showAuthMessage('quick-admin-error');

  document.getElementById('modal-user-account').classList.remove('hidden');
}

async function handleQuickUpgradeToAdmin() {
  const password = document.getElementById('quick-admin-pwd-input');
  const user = await completeUserLogin('login', {
    name: AppState.currentUser?.name,
    role: 'admin',
    password: password.value,
    court_id: AppState.currentCourtId
  }, 'quick-admin-error', document.getElementById('quick-admin-submit'));
  if (user) password.value = '';
}

async function handleLogout() {
  const response = await apiPost('/api/auth/logout', {});
  if (!response || response.error) {
    showToast('Gagal keluar. Periksa koneksi dan coba lagi.');
    return;
  }
  AppState.currentUser = null;
  AppState.refereeMatches = [];
  syncAccessUI();
  AppState.users = [];
  switchTab('scorer');
  document.getElementById('modal-user-account').classList.add('hidden');
  document.getElementById('auth-gate-modal').classList.remove('hidden');
  populateLoginPlayerPicker();
  selectLoginRole('member');
}

// ============================================================================
// 3. API HELPERS
// ============================================================================
async function apiGet(endpoint, includeError = false) {
  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok && !includeError) return null;
    return await res.json();
  } catch (e) {
    console.warn('API GET Warning:', endpoint, e);
    return null;
  }
}

async function apiWrite(endpoint, method, body) {
  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 401 && !endpoint.startsWith('/api/auth/')) {
      AppState.currentUser = null;
      AppState.users = [];
      switchTab('scorer');
      document.getElementById('auth-gate-modal').classList.remove('hidden');
      selectLoginRole('member');
      showAuthMessage('member-login-error', 'Sesi sudah berakhir. Silakan masuk kembali.');
    }
    return {
      ...(await response.json()),
      commitRevision: Number(response.headers.get('X-DF-Revision')) || undefined,
      httpStatus: response.status
    };
  } catch {
    return null;
  }
}

function apiPost(endpoint, body) { return apiWrite(endpoint, 'POST', body); }
function apiPut(endpoint, body) { return apiWrite(endpoint, 'PUT', body); }

async function loadSettings() { await fetchBootstrapData(); }
async function loadPlayers() { await fetchBootstrapData(); }
async function loadTournaments() { await fetchBootstrapData(); }
async function loadMatches() { await fetchBootstrapData(); }
async function loadUsers() { await fetchBootstrapData(); }

// ============================================================================
// 4. NAVIGATION & TAB MANAGEMENT
// ============================================================================
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  const soundBtn = document.getElementById('btn-toggle-sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const current = window.soundEngine.soundEnabled;
      window.soundEngine.setSoundEnabled(!current);
      localStorage.setItem('df_sound_enabled', String(!current));
      updateSoundIcon();
      showToast(window.soundEngine.soundEnabled ? '🔊 Suara & Wasit Aktif' : '🔇 Suara Dimatikan');
    });
  }

  const sunBtn = document.getElementById('btn-toggle-sunlight');
  if (sunBtn) {
    sunBtn.addEventListener('click', () => {
      document.body.classList.toggle('sunlight-mode');
      const isSun = document.body.classList.contains('sunlight-mode');
      localStorage.setItem('sunlight_mode', isSun);
      showToast(isSun ? '☀️ Mode Lapangan Terang (Outdoor)' : '🌙 Mode Standar Gelap');
    });
  }
}

function updateSoundIcon() {
  const icon = document.getElementById('sound-icon');
  if (!icon) return;
  if (window.soundEngine.soundEnabled) {
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />`;
    icon.classList.remove('text-slate-400');
    icon.classList.add('text-emerald-400');
  } else {
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />`;
    icon.classList.add('text-slate-400');
    icon.classList.remove('text-emerald-400');
  }
}

function switchTab(tab) {
  if (tab === 'admin' || tab === 'settings') {
    if (!AppState.currentUser) {
      document.getElementById('auth-gate-modal').classList.remove('hidden');
      selectLoginRole('admin');
      return;
    }
    if (AppState.currentUser.role !== 'admin') {
      openUserAccountModal();
      return;
    }
  }
  if (tab !== 'scorer') closeFinishModal();
  AppState.currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      if (tab === 'admin') {
        btn.className = 'nav-btn px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-1.5 whitespace-nowrap transition bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg';
      } else {
        btn.className = 'nav-btn px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-1.5 whitespace-nowrap transition bg-emerald-600 text-white shadow-lg';
      }
    } else {
      if (btn.dataset.tab === 'admin') {
        btn.className = 'nav-btn px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-1.5 whitespace-nowrap text-blue-300 bg-blue-950/40 border border-blue-500/30 hover:bg-blue-900/50 transition';
      } else {
        btn.className = 'nav-btn px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-1.5 whitespace-nowrap text-slate-300 hover:bg-slate-800 transition';
      }
    }
  });

  if (tab === 'admin') renderAdminDashboard();
  if (tab === 'tournaments') renderTournamentsList();
  if (tab === 'players') renderPlayersTab();
  if (tab === 'history') renderHistoryTab();
  if (tab === 'settings') renderSettingsTab();
}

// ============================================================================
// 5. SHARED COURTS
// ============================================================================
function populateCourtDropdowns() {
  for (const id of ['header-court-select', 'new-match-court-select', 'member-login-court']) {
    const select = document.getElementById(id);
    if (!select) continue;
    select.replaceChildren(...AppState.courts.map(court => new Option(court.name, court.id)));
    select.value = AppState.currentCourtId;
  }
  updateCourtAvailability();
}

function getCourtDisplayName(courtId) {
  return DEFAULT_COURTS.find(court => court.id === courtId)?.name || courtId;
}

function updateCourtAvailability() {
  const ready = AppState.courtRevision >= 0 && !AppState.pendingCourtAction;
  const free = !AppState.courts.find(court => court.id === AppState.currentCourtId)?.active_match;
  document.querySelectorAll('[data-new-match]').forEach(button => { button.disabled = !ready || !free; });
  const select = document.getElementById('new-match-court-select');
  for (const option of select.options) {
    const occupied = AppState.courts.find(court => court.id === option.value)?.active_match;
    option.disabled = Boolean(occupied);
    option.textContent = getCourtDisplayName(option.value) + (occupied ? ' · Sedang dipakai' : '');
  }
  const submit = document.getElementById('new-match-submit');
  submit.disabled = !ready || !select.value || select.selectedOptions[0]?.disabled;
  document.getElementById('active-scoreboard').disabled = AppState.pendingCourtAction;
  document.getElementById('finish-save-button').disabled = AppState.pendingCourtAction;
}

function renderCurrentCourt() {
  const active = AppState.courts.find(court => court.id === AppState.currentCourtId)?.active_match;
  if (AppState.scorer?.id === active?.id && AppState.scorer?.version === active?.version) {
    updateScoreboardUI();
    return;
  }
  if (AppState.finishContext) closeFinishModal();
  document.getElementById('modal-walkover-win').classList.add('hidden');
  document.getElementById('quick-target-games-modal').classList.add('hidden');
  AppState.scorer = active ? MatchScorer.fromJSON(active) : null;
  updateScoreboardUI(true);
  renderMatchTimer();
}

function renderCourtViews() {
  renderCurrentCourt();
  updateCourtAvailability();
  if (AppState.currentTab === 'admin') {
    renderAdminKpiCards();
    renderAdminLiveCourts();
  }
  if (!document.getElementById('modal-multi-court').classList.contains('hidden')) renderMultiCourtGrid();
  if (AppState.selectedTournament && !document.getElementById('bracket-modal').classList.contains('hidden')) renderBracketContent(AppState.selectedTournament);
}

function applyCourtSnapshot(state) {
  if (state.revision <= AppState.courtRevision) return;
  AppState.courtRevision = state.revision;
  AppState.courts = state.courts.map(court => {
    const acknowledged = AppState.courtAcknowledgements.get(court.id);
    if (acknowledged?.revision > state.revision) return acknowledged.court;
    AppState.courtAcknowledgements.delete(court.id);
    return court;
  });
  renderCourtViews();
}

function handleCourtSwitch(courtId) {
  if (!DEFAULT_COURTS.some(court => court.id === courtId)) return;
  AppState.currentCourtId = courtId;
  localStorage.setItem('padel_active_court_id', courtId);
  document.getElementById('header-court-select').value = courtId;
  renderCurrentCourt();
  updateCourtAvailability();
  pollSharedState();
}

async function runCourtRequest(courtId, action, body) {
  if (AppState.pendingCourtAction) return null;
  AppState.pendingCourtAction = true;
  updateCourtAvailability();
  setSyncIndicator('syncing');
  try {
    const response = await apiPost(`/api/courts/${courtId}/${action}`, body);
    if (response?.court && response.commitRevision >= AppState.courtRevision) {
      AppState.courtAcknowledgements.set(courtId, { revision: response.commitRevision, court: response.court });
      AppState.courts = AppState.courts.map(court => court.id === courtId ? response.court : court);
      renderCourtViews();
    }
    if (!response || response.error) {
      setSyncIndicator(response && response.httpStatus < 500 ? 'online' : 'offline');
      showToast(response?.error || 'Koneksi terputus. Periksa skor terbaru sebelum mencoba lagi.');
      return null;
    }
    setSyncIndicator('online');
    return response;
  } finally {
    AppState.pendingCourtAction = false;
    updateCourtAvailability();
    pollSharedState();
  }
}

function openMultiCourtMonitorModal() {
  document.getElementById('modal-multi-court').classList.remove('hidden');
  renderMultiCourtGrid();
  pollSharedState();
}

function closeMultiCourtMonitorModal() {
  document.getElementById('modal-multi-court').classList.add('hidden');
}

function buildCourtMonitorCardHTML(c, isAdminView = false) {
  const isCurrent = c.id === AppState.currentCourtId;
  const m = c.active_match && (c.active_match.team_a_name || c.active_match.team_a) ? c.active_match : null;
  const isLive = m && !m.is_completed && m.status !== 'completed';
  const isComplete = m && (m.is_completed || m.status === 'completed');

  let matchBody = '';
  if (m) {
    const isDoubles = m.mode === 'doubles';
    const setsStr = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(', ');
    const setsWonA = m.sets_won ? m.sets_won.team_a : (m.sets_history || []).filter(s => s.winner === 'team_a').length;
    const setsWonB = m.sets_won ? m.sets_won.team_b : (m.sets_history || []).filter(s => s.winner === 'team_b').length;
    const gamesA = m.current_set_games ? m.current_set_games.team_a : 0;
    const gamesB = m.current_set_games ? m.current_set_games.team_b : 0;
    const ptA = m.display_point_a !== undefined ? m.display_point_a : '0';
    const ptB = m.display_point_b !== undefined ? m.display_point_b : '0';
    const refName = m.scored_by?.name || 'Wasit Lapangan';

    matchBody = `
      <div class="space-y-2.5">
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span class="font-bold uppercase text-emerald-400">${escapeHTML((m.sport || 'Padel').toUpperCase())} • ${isDoubles ? 'Ganda 2v2' : 'Tunggal 1v1'}</span>
          <span class="font-mono text-slate-300">${m.rules?.golden_point ? '⭐ Golden Pt' : '🎾 Deuce'} • Target ${escapeHTML(m.rules?.games_per_set || 6)}G</span>
        </div>

        <div class="p-3 bg-slate-950/90 rounded-2xl border border-slate-800 space-y-2">
          <!-- Header Labels -->
          <div class="flex items-center justify-between text-[9px] uppercase font-bold text-slate-500 border-b border-slate-800/80 pb-1">
            <span>Tim Bertanding</span>
            <div class="flex items-center space-x-3">
              <span>SET</span>
              <span>GAME</span>
              <span>POIN</span>
            </div>
          </div>

          <!-- Team A -->
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2 truncate pr-2">
              <span class="text-xs font-bold ${m.server === 'team_a' ? 'text-emerald-400' : 'text-slate-600'}">${m.server === 'team_a' ? '🎾' : '•'}</span>
              <span class="text-sm font-bold text-white truncate">${escapeHTML(m.team_a_name || 'Tim A')}</span>
            </div>
            <div class="flex items-center space-x-3 font-mono font-bold text-sm">
              <span class="text-amber-400 font-extrabold w-4 text-center">${escapeHTML(setsWonA)}</span>
              <span class="text-white w-4 text-center">${escapeHTML(gamesA)}</span>
              <span class="text-emerald-400 bg-slate-800 px-2 py-0.5 rounded min-w-[32px] text-center">${escapeHTML(ptA)}</span>
            </div>
          </div>

          <!-- Team B -->
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2 truncate pr-2">
              <span class="text-xs font-bold ${m.server === 'team_b' ? 'text-amber-400' : 'text-slate-600'}">${m.server === 'team_b' ? '🎾' : '•'}</span>
              <span class="text-sm font-bold text-white truncate">${escapeHTML(m.team_b_name || 'Tim B')}</span>
            </div>
            <div class="flex items-center space-x-3 font-mono font-bold text-sm">
              <span class="text-amber-400 font-extrabold w-4 text-center">${escapeHTML(setsWonB)}</span>
              <span class="text-white w-4 text-center">${escapeHTML(gamesB)}</span>
              <span class="text-emerald-400 bg-slate-800 px-2 py-0.5 rounded min-w-[32px] text-center">${escapeHTML(ptB)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span>👤 Pencatat: <strong class="text-slate-200">${escapeHTML(refName)}</strong></span>
          <span>🕒 ${c.last_updated ? c.last_updated.substring(11, 19) : 'Baru saja'}</span>
        </div>

        ${setsStr ? `<div class="text-[11px] text-slate-400 font-mono">Riwayat Set: <span class="text-emerald-300 font-bold">${escapeHTML(setsStr)}</span></div>` : ''}
        ${m.win_reason ? `<div class="text-xs font-bold text-red-300 bg-red-950/60 p-2 rounded-xl border border-red-500/30">🏆 ${escapeHTML(m.win_reason)}</div>` : ''}
      </div>
    `;
  } else {
    matchBody = `
      <div class="py-8 text-center text-slate-500">
        <span class="text-3xl block mb-1.5">🎾</span>
        <p class="text-xs font-semibold">Lapangan Standby / Kosong</p>
        <p class="text-[10px] text-slate-600 mt-0.5">Belum ada pertandingan yang sedang berlangsung</p>
      </div>
    `;
  }

  return `
    <div class="p-4 sm:p-5 rounded-3xl border-2 transition ${isCurrent ? 'bg-slate-900 border-emerald-500/80 shadow-xl' : 'bg-slate-950/70 border-slate-800'} flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-2">
            <span class="text-lg">🏟️</span>
            <h4 class="text-sm sm:text-base font-black text-white">${c.name || getCourtDisplayName(c.id)}</h4>
          </div>
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${isLive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse' : isComplete ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800 text-slate-400'}">
            ${isLive ? '● LIVE PLAY' : isComplete ? '🏆 SELESAI' : 'STANDBY'}
          </span>
        </div>

        ${matchBody}
      </div>

      <div class="pt-3 border-t border-slate-800/80 mt-3 flex flex-wrap items-center gap-1.5">
        <button onclick="switchToCourtAndOpenScorer(${htmlArgument(c.id)})" class="flex-1 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 font-bold rounded-xl text-xs transition">
          🎯 ${isCurrent ? 'Buka Papan Skor' : 'Kendalikan Lapangan Ini'}
        </button>
        ${isAdminView && m ? `
          <button onclick="handleAdminClearCourt(${htmlArgument(c.id)})" title="Kosongkan / Reset sesi lapangan ini" class="px-2.5 py-2 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 font-bold rounded-xl text-xs transition">
            🧹 Reset
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderMultiCourtGrid() {
  document.getElementById('multi-court-grid').innerHTML = AppState.courts
    .map(court => buildCourtMonitorCardHTML(court)).join('');
}

function switchToCourtAndOpenScorer(courtId) {
  closeMultiCourtMonitorModal();
  handleCourtSwitch(courtId);
  switchTab('scorer');
}

function renderMatchTimer() {
  const scorer = AppState.scorer;
  if (!scorer) return;
  const end = scorer.end_time || new Date();
  AppState.matchDurationSecs = Math.max(0, Math.floor((end - scorer.start_time) / 1000));
  const mins = Math.floor(AppState.matchDurationSecs / 60);
  const secs = AppState.matchDurationSecs % 60;
  document.getElementById('match-timer').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startMatchTimer() {
  setInterval(renderMatchTimer, 1000);
}

function escapeHTML(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function htmlArgument(value) {
  return escapeHTML(JSON.stringify(value));
}

// Resolve player photo from AppState.players by id/name if stripped in light JSON
function resolvePlayerPhoto(playerObj, fallbackSeed) {
  if (!playerObj) return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(fallbackSeed || 'Player')}`;
  if (playerObj.photo_url) return playerObj.photo_url;
  const fullP = (AppState.players || []).find(p => p.id === playerObj.id || p.name === playerObj.name);
  if (fullP && fullP.photo_url) return fullP.photo_url;
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(playerObj.name || fallbackSeed || 'Player')}`;
}

function triggerDigitPop(el) {
  if (!el) return;
  el.classList.remove('score-pop');
  void el.offsetWidth; // Reflow for instant CSS keyframe restart
  el.classList.add('score-pop');
}

function updateScoreboardUI(forceHeaderRebuild = false) {
  const s = AppState.scorer;
  syncAccessUI();
  document.getElementById('active-scoreboard').classList.toggle('hidden', !s);
  document.getElementById('empty-court').classList.toggle('hidden', Boolean(s));
  document.getElementById('empty-court-title').textContent = getCourtDisplayName(AppState.currentCourtId);
  document.getElementById('empty-court-description').textContent = AppState.courtRevision < 0
    ? 'Menghubungkan ke database bersama…'
    : 'Lapangan kosong. Buat pertandingan untuk mulai mencatat skor.';
  if (!s) return;

  document.getElementById('pending-result-label').classList.toggle('hidden', !s.is_completed);
  document.getElementById('btn-add-point-a').disabled = s.is_completed;
  document.getElementById('btn-add-point-b').disabled = s.is_completed;
  const isDoubles = s.mode === 'doubles';

  // Active Court Badge
  const courtBadge = document.getElementById('match-active-court-badge');
  if (courtBadge) {
    courtBadge.textContent = `🏟️ ${getCourtDisplayName(s.court_id || AppState.currentCourtId).toUpperCase()}`;
  }

  // Sport & Mode Tag
  const sportTag = document.getElementById('match-sport-tag');
  if (sportTag) {
    const modeLabel = isDoubles ? 'GANDA (2v2)' : 'TUNGGAL (1v1)';
    sportTag.textContent = `${s.sport.toUpperCase()} • ${modeLabel} • BEST OF ${s.rules.sets_to_win * 2 - 1}`;
  }

  // Target Games Indicator
  const targetLabel = document.getElementById('match-target-games-label');
  if (targetLabel) {
    targetLabel.textContent = `${s.rules.games_per_set} Game`;
  }

  // Scoring Mode Pill
  const modePill = document.getElementById('scoring-mode-pill');
  const modeText = document.getElementById('scoring-mode-text');
  const modeIcon = document.getElementById('scoring-mode-icon');
  if (modePill && modeText && modeIcon) {
    if (s.rules.golden_point) {
      modePill.className = 'px-2.5 py-1 rounded-lg text-xs font-bold border transition flex items-center space-x-1 bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30';
      modeText.textContent = 'Mode: Golden Point ⭐';
      modeIcon.textContent = '⭐';
    } else {
      modePill.className = 'px-2.5 py-1 rounded-lg text-xs font-bold border transition flex items-center space-x-1 bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30';
      modeText.textContent = 'Mode: Deuce (Advantage)';
      modeIcon.textContent = '🎾';
    }
  }

  // --- TEAM A & TEAM B HEADERS (Only rebuild DOM when players/server change!) ---
  renderTeamScoreHeader('a', s.team_a, s.server === 'team_a', isDoubles, s.server_player_index.team_a, forceHeaderRebuild);
  renderTeamScoreHeader('b', s.team_b, s.server === 'team_b', isDoubles, s.server_player_index.team_b, forceHeaderRebuild);

  // Digits Grid (Points, Games, Sets)
  const ptA = s.getDisplayPoint('team_a');
  const ptB = s.getDisplayPoint('team_b');
  const elPtA = document.getElementById('digit-point-a');
  const elPtB = document.getElementById('digit-point-b');

  if (elPtA) {
    if (elPtA.textContent !== ptA) {
      elPtA.textContent = ptA;
      triggerDigitPop(elPtA);
    }
  }
  if (elPtB) {
    if (elPtB.textContent !== ptB) {
      elPtB.textContent = ptB;
      triggerDigitPop(elPtB);
    }
  }

  document.getElementById('score-games-a').textContent = s.current_set_games.team_a;
  document.getElementById('score-games-b').textContent = s.current_set_games.team_b;
  document.getElementById('score-sets-a').textContent = s.getSetsWon('team_a');
  document.getElementById('score-sets-b').textContent = s.getSetsWon('team_b');

  // Sub-badges under point digit
  const ptBadgeA = document.getElementById('point-badge-a');
  const ptBadgeB = document.getElementById('point-badge-b');
  if (ptBadgeA && ptBadgeB) {
    if (ptA === 'AD') {
      ptBadgeA.textContent = '★ ADVANTAGE';
      ptBadgeB.innerHTML = '&nbsp;';
    } else if (ptB === 'AD') {
      ptBadgeB.textContent = '★ ADVANTAGE';
      ptBadgeA.innerHTML = '&nbsp;';
    } else if (s.isDeuce()) {
      ptBadgeA.textContent = 'DEUCE';
      ptBadgeB.textContent = 'DEUCE';
    } else if (s.isGoldenPoint()) {
      ptBadgeA.textContent = 'GOLDEN PT';
      ptBadgeB.textContent = 'GOLDEN PT';
    } else if (s.is_tiebreak || s.is_super_tiebreak) {
      ptBadgeA.textContent = 'TIE-BREAK';
      ptBadgeB.textContent = 'TIE-BREAK';
    } else {
      ptBadgeA.innerHTML = '&nbsp;';
      ptBadgeB.innerHTML = '&nbsp;';
    }
  }

  // DEUCE Banner vs Golden Point Banner
  const deuceBanner = document.getElementById('deuce-banner');
  const goldBanner = document.getElementById('golden-point-banner');
  if (deuceBanner && goldBanner) {
    if (s.isDeuce()) {
      deuceBanner.classList.remove('hidden');
      deuceBanner.textContent = '🎾 DEUCE (40 - 40) - Perebutan Poin Keuntungan (Advantage)!';
      goldBanner.classList.add('hidden');
    } else if (s.isGoldenPoint()) {
      goldBanner.classList.remove('hidden');
      deuceBanner.classList.add('hidden');
    } else if (s.hasAdvantage()) {
      const advTeam = s.getAdvantageTeam();
      const advName = advTeam === 'team_a' ? s.team_a.name : s.team_b.name;
      deuceBanner.classList.remove('hidden');
      deuceBanner.textContent = `⚡ ADVANTAGE: ${advName} - Butuh 1 Poin untuk Menang Game!`;
      goldBanner.classList.add('hidden');
    } else {
      deuceBanner.classList.add('hidden');
      goldBanner.classList.add('hidden');
    }
  }

  // Dynamic Add Point Button Texts
  const btnTextA = document.getElementById('btn-text-point-a');
  const btnTextB = document.getElementById('btn-text-point-b');
  if (btnTextA && btnTextB) {
    if (s.isDeuce()) {
      btnTextA.textContent = '+ POIN TIM A (ADVANTAGE)';
      btnTextB.textContent = '+ POIN TIM B (ADVANTAGE)';
    } else if (s.hasAdvantage()) {
      if (s.getAdvantageTeam() === 'team_a') {
        btnTextA.textContent = '🏆 + MENANGKAN GAME (TIM A)';
        btnTextB.textContent = '↩ + KEMBALI KE DEUCE (TIM B)';
      } else {
        btnTextA.textContent = '↩ + KEMBALI KE DEUCE (TIM A)';
        btnTextB.textContent = '🏆 + MENANGKAN GAME (TIM B)';
      }
    } else if (s.isGoldenPoint()) {
      btnTextA.textContent = '⭐ + POIN PENENTU TIM A';
      btnTextB.textContent = '⭐ + POIN PENENTU TIM B';
    } else {
      btnTextA.textContent = '+ POIN TIM A';
      btnTextB.textContent = '+ POIN TIM B';
    }
  }

  // Side switch notification
  const sideBanner = document.getElementById('side-switch-banner');
  if (sideBanner) {
    sideBanner.classList.toggle('hidden', !s.side_switch_alert);
  }

  // Sets History Badges
  const historyContainer = document.getElementById('sets-history-pills');
  if (historyContainer) {
    historyContainer.innerHTML = s.sets_history.map((set, idx) => `
      <div class="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono font-bold flex items-center space-x-1 whitespace-nowrap">
        <span class="text-slate-400">Set ${idx + 1}:</span>
        <span class="text-emerald-400">${escapeHTML(set.team_a)}</span><span>-</span><span class="text-amber-400">${escapeHTML(set.team_b)}</span>
      </div>
    `).join('');
  }

  // Live Match Mini Stats Strip
  const statPointsEl = document.getElementById('live-stat-points');
  const statDeucesEl = document.getElementById('live-stat-deuces');
  const statStreakEl = document.getElementById('live-stat-streak');
  const statRefEl = document.getElementById('live-stat-referee');

  if (statPointsEl) statPointsEl.textContent = `${s.stats?.total_points_a || 0} - ${s.stats?.total_points_b || 0}`;
  if (statDeucesEl) statDeucesEl.textContent = `${(s.stats?.deuces_count || 0) + (s.stats?.golden_points_count || 0)}x`;
  if (statStreakEl) statStreakEl.textContent = `${s.stats?.max_streak_a || 0} - ${s.stats?.max_streak_b || 0}`;
  if (statRefEl) statRefEl.textContent = s.scored_by?.name || AppState.currentUser?.name || 'Wasit';

  // Undo & Redo button states
  const undoBtn = document.getElementById('btn-undo-point');
  if (undoBtn) {
    undoBtn.disabled = !s.undo_count;
  }
  const redoBtn = document.getElementById('btn-redo-point');
  if (redoBtn) {
    redoBtn.disabled = !s.redo_count;
  }

  // Active server status text
  const serverTextEl = document.getElementById('server-toggle-text');
  if (serverTextEl) {
    const activePlayer = s.getActiveServerPlayer();
    serverTextEl.textContent = `Servis: ${activePlayer.name}`;
  }
  syncAccessUI();

}

function renderTeamScoreHeader(teamKey, teamObj, isServingTeam, isDoubles, activePlayerIdx, forceRebuild = false) {
  const nameEl = document.getElementById(`score-name-${teamKey}`);
  const badgeEl = document.getElementById(`score-mode-badge-${teamKey}`);
  const ballEl = document.getElementById(`server-indicator-${teamKey}`);
  const avatarsWrap = document.getElementById(`score-avatars-${teamKey}`);
  const chipsWrap = document.getElementById(`doubles-players-chips-${teamKey}`);

  if (nameEl && nameEl.textContent !== teamObj.name) nameEl.textContent = teamObj.name;
  if (badgeEl) badgeEl.classList.toggle('hidden', !isDoubles);
  if (ballEl) ballEl.classList.toggle('hidden', !isServingTeam);

  // Compute state hash so we DON'T destroy and recreate <img> tags on every point tap!
  const pNames = (teamObj.players || []).map(p => `${p.id || ''}:${p.name || ''}`).join('|');
  const currentHash = `${teamObj.name}_${isDoubles}_${isServingTeam}_${activePlayerIdx}_${pNames}_${canScoreMatch()}`;
  const hashKey = teamKey === 'a' ? 'lastHeaderHashA' : 'lastHeaderHashB';

  if (!forceRebuild && AppState[hashKey] === currentHash) {
    return;
  }
  AppState[hashKey] = currentHash;

  if (avatarsWrap) {
    const players = isDoubles ? teamObj.players.slice(0, 2) : [teamObj.players[0] || { name: teamObj.name }];
    avatarsWrap.innerHTML = players.map((player, index) => `<button type="button" class="player-slogan-photo" data-slogan-team="team_${teamKey}" data-slogan-index="${index}" title="${escapeHTML('Putar slogan ' + player.name)}" aria-label="${escapeHTML('Putar slogan ' + player.name)}" ${canScoreMatch() ? '' : 'disabled'}><img src="${escapeHTML(resolvePlayerPhoto(player, player.name))}" class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 border-emerald-500/50" alt="${escapeHTML(player.name)}"></button>`).join('');
    avatarsWrap.querySelectorAll('[data-slogan-team]').forEach(button => {
      button.onclick = () => playScoringPlayerSlogan(button.dataset.sloganTeam, Number(button.dataset.sloganIndex));
    });
  }

  if (chipsWrap) {
    if (isDoubles && teamObj.players && teamObj.players.length >= 2) {
      chipsWrap.classList.remove('hidden');
      chipsWrap.innerHTML = teamObj.players.slice(0, 2).map((player, idx) => {
        const isThisServing = isServingTeam && (activePlayerIdx === idx);
        return `
          <button onclick="handleSelectDoublesServer('team_${teamKey}', ${idx})" title="Klik untuk jadikan server" class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition ${isThisServing ? 'bg-emerald-600 text-white font-bold border border-emerald-400 shadow-sm' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}">
            <span>${isThisServing ? '🎾' : '👤'}</span>
            <span class="truncate max-w-[110px]">${escapeHTML(player.name || `Pemain ${idx + 1}`)}</span>
            ${isThisServing ? '<span class="text-[9px] bg-emerald-950 px-1 py-0.2 rounded font-black text-emerald-300">SERVIS</span>' : ''}
          </button>
        `;
      }).join('');
    } else {
      chipsWrap.classList.add('hidden');
    }
  }
}

// ============================================================================
// 7. SCORER ACTIONS (INSTANT 0ms UI)
// ============================================================================
async function runScoreAction(action) {
  const scorer = AppState.scorer;
  if (!scorer || !canScoreMatch() || AppState.pendingCourtAction) return;
  const response = await runCourtRequest(scorer.court_id, 'score', {
    match_id: scorer.id, version: scorer.version, action
  });
  const latest = AppState.scorer;
  if (!response || latest?.id !== scorer.id) return;
  if (action.type === 'point') {
    window.soundEngine.playPointBeep();
    if (!latest.is_completed) {
      if (latest.getSetsWon(action.team) > scorer.getSetsWon(action.team)) {
        window.soundEngine.announceSet(latest[action.team].name, latest.sets_history.length,
          latest.getSetsWon('team_a'), latest.getSetsWon('team_b'));
      } else if (latest.current_set_games[action.team] > scorer.current_set_games[action.team]) {
        window.soundEngine.announceGame(latest[action.team].name, latest.current_set_games.team_a, latest.current_set_games.team_b);
      } else latest.announceCurrentScore();
      if (latest.side_switch_alert && !scorer.side_switch_alert) window.soundEngine.announceSideSwitch();
    }
  }
  if (action.type === 'undo') window.soundEngine.playUndoBeep();
  if (latest.is_completed && !scorer.is_completed) {
    window.soundEngine.announceMatch(latest[latest.winner].name);
    if (AppState.currentTab === 'scorer') showMatchCompletedModal();
  }
}

function handlePoint(team) { return runScoreAction({ type: 'point', team }); }
function handleUndo() { return runScoreAction({ type: 'undo' }); }
function handleRedo() { return runScoreAction({ type: 'redo' }); }
function handleToggleServer() { return runScoreAction({ type: 'server' }); }
function handleSelectDoublesServer(team, player) { return runScoreAction({ type: 'doubles_server', team, player }); }
function handleToggleGoldenPoint() { return runScoreAction({ type: 'golden_point' }); }

function handleResetCurrentMatch() {
  if (AppState.scorer && confirm('Reset skor pertandingan ini kembali ke 0 - 0?')) {
    return runScoreAction({ type: 'reset' });
  }
}

function openQuickTargetGamesModal() {
  document.getElementById('quick-target-games-modal').classList.remove('hidden');
}

function applyQuickTargetGames(num) {
  const val = parseInt(num);
  if (!val || val < 1) {
    alert('Masukkan jumlah game minimal 1!');
    return;
  }
  if (!AppState.scorer) return;
  document.getElementById('quick-target-games-modal').classList.add('hidden');
  return runScoreAction({ type: 'target', games: val });
}

function handleDismissSideSwitch() {
  if (AppState.scorer) {
    AppState.scorer.side_switch_alert = false;
    updateScoreboardUI(false);
  }
}

// Walkover / Disqualification Win
function openWalkoverModal() {
  if (!AppState.scorer || AppState.scorer.is_completed) {
    showToast('Pertandingan sudah selesai atau belum dimulai.');
    return;
  }

  const lblA = document.getElementById('wo-team-a-label');
  const lblB = document.getElementById('wo-team-b-label');
  if (lblA) lblA.textContent = AppState.scorer.team_a.name;
  if (lblB) lblB.textContent = AppState.scorer.team_b.name;

  const noteInput = document.getElementById('wo-custom-note');
  if (noteInput) noteInput.value = '';

  document.getElementById('modal-walkover-win').classList.remove('hidden');
}

function confirmWalkoverWin() {
  if (!AppState.scorer) return;

  const winnerRadio = document.querySelector('input[name="wo-winner"]:checked');
  const winnerTeam = winnerRadio ? winnerRadio.value : 'team_a';
  const reasonType = document.getElementById('wo-reason-select').value;
  const customNote = document.getElementById('wo-custom-note').value.trim();

  document.getElementById('modal-walkover-win').classList.add('hidden');
  return runScoreAction({ type: 'walkover', team: winnerTeam, reason: reasonType, note: customNote });
}

// Match Completion Modal & Victory Slogan
function closeFinishModal() {
  AppState.finishContext = null;
  document.getElementById('match-finish-modal').classList.add('hidden');
}

function showMatchCompletedModal() {
  const s = AppState.scorer;
  if (!s || !canScoreMatch() || AppState.pendingCourtAction) return;
  AppState.finishContext = { courtId: s.court_id, match_id: s.id, version: s.version };
  const modal = document.getElementById('match-finish-modal');
  const manual = !s.is_completed;
  document.getElementById('finish-title').textContent = manual ? 'Selesaikan Pertandingan' : 'Konfirmasi Hasil Pertandingan';
  document.getElementById('finish-manual').classList.toggle('hidden', !manual);
  document.getElementById('finish-celebration').classList.toggle('hidden', manual);
  if (manual) {
    const winner = document.getElementById('finish-winner-select');
    winner.replaceChildren(new Option('Pilih pemenang', ''), new Option(s.team_a.name, 'team_a'),
      new Option(s.team_b.name, 'team_b'));
    modal.classList.remove('hidden');
    return;
  }

  const winnerTeam = s.winner === 'team_a' ? s.team_a : s.team_b;
  const winnerName = winnerTeam.name;

  if (window.confetti) {
    window.confetti({ particleCount: 130, spread: 80, origin: { y: 0.6 } });
  }

  document.getElementById('finish-winner-name').textContent = winnerName;

  const avatarsWrap = document.getElementById('finish-winner-avatars-wrap');
  if (avatarsWrap) {
    if (s.mode === 'doubles' && winnerTeam.players && winnerTeam.players.length >= 2) {
      const p1 = winnerTeam.players[0];
      const p2 = winnerTeam.players[1];
      const img1 = resolvePlayerPhoto(p1, 'W1');
      const img2 = resolvePlayerPhoto(p2, 'W2');
      avatarsWrap.innerHTML = `
        <div class="doubles-avatar-wrap">
          <img src="${escapeHTML(img1)}" class="w-20 h-20 rounded-3xl object-cover border-4 border-amber-400 shadow-xl">
          <img src="${escapeHTML(img2)}" class="w-20 h-20 rounded-3xl object-cover border-4 border-amber-300 shadow-xl">
        </div>
      `;
    } else {
      const p = (winnerTeam.players && winnerTeam.players[0]) || { name: winnerName, photo_url: winnerTeam.photo };
      const img = resolvePlayerPhoto(p, winnerName);
      avatarsWrap.innerHTML = `
        <img src="${escapeHTML(img)}" class="w-24 h-24 rounded-3xl object-cover border-4 border-amber-400 shadow-xl">
      `;
    }
  }

  const badgeEl = document.getElementById('finish-win-reason-badge');
  if (badgeEl) {
    if (s.win_type && s.win_type !== 'normal') {
      badgeEl.classList.remove('hidden');
      badgeEl.textContent = s.win_reason || (s.win_type === 'disqualification' ? 'Menang Diskualifikasi (DQ)' : 'Menang W.O.');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  const scoreSummary = s.sets_history.map(set => `${escapeHTML(set.team_a)}-${escapeHTML(set.team_b)}`).join(' | ');
  document.getElementById('finish-score-summary').textContent = `Skor Akhir: ${scoreSummary || 'Game Selesai'}`;
  document.getElementById('finish-duration').textContent = `Durasi: ${Math.max(1, Math.floor(AppState.matchDurationSecs / 60))} Menit • Total Poin: ${(s.stats?.total_points_a || 0) + (s.stats?.total_points_b || 0)}`;

  // Victory Slogan Playback
  const sloganBox = document.getElementById('finish-slogan-box');
  const sloganTextEl = document.getElementById('finish-slogan-text');
  let winningPlayerWithSlogan = null;

  if (winnerTeam.players && winnerTeam.players.length > 0) {
    for (const p of winnerTeam.players) {
      const fullP = AppState.players.find(x => x.id === p.id || x.name === p.name) || p;
      if (fullP.slogan_audio_url || fullP.slogan_text) {
        winningPlayerWithSlogan = fullP;
        break;
      }
    }
  }

  if (winningPlayerWithSlogan) {
    AppState.lastWinnerData = { player: winningPlayerWithSlogan, teamName: winnerName };
    if (sloganBox) sloganBox.classList.remove('hidden');
    if (sloganTextEl) sloganTextEl.textContent = `"${winningPlayerWithSlogan.slogan_text || 'Juara Pantang Menyerah!'}"`;
    window.soundEngine.playVictorySlogan(winningPlayerWithSlogan, winnerName);
  } else {
    AppState.lastWinnerData = { player: null, teamName: winnerName };
    if (sloganBox) sloganBox.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function replayVictorySlogan() {
  if (AppState.lastWinnerData && AppState.lastWinnerData.player) {
    window.soundEngine.playVictorySlogan(AppState.lastWinnerData.player, AppState.lastWinnerData.teamName);
    showToast('▶️ Memutar suara slogan juara...');
  } else {
    showToast('Pemain belum merekam slogan kemenangan.');
  }
}

async function saveAndFinishMatch() {
  const context = AppState.finishContext;
  const scorer = AppState.scorer;
  if (!context || !scorer) return;
  const winner = scorer.winner || document.getElementById('finish-winner-select').value;
  if (!winner) {
    showToast('Pilih pemenang terlebih dahulu.');
    return;
  }
  const response = await runCourtRequest(context.courtId, 'finish', {
    match_id: context.match_id, version: context.version, winner
  });
  if (!response) return;
  closeFinishModal();
  await fetchBootstrapData();
  showToast('✅ Hasil disimpan. Lapangan siap untuk pertandingan berikutnya.');
}

// ============================================================================
// 8. NEW MATCH SETUP MODAL (SINGLES 1v1 & DOUBLES 2v2)
// ============================================================================
function startNewMatchPrompt() {
  if (AppState.courtRevision < 0 || AppState.pendingCourtAction || AppState.courts.find(court => court.id === AppState.currentCourtId)?.active_match) {
    showToast('Pilih lapangan kosong yang terhubung ke server.');
    return;
  }
  populateCourtDropdowns();
  populateNewMatchPlayerDropdowns();
  const modeSel = document.getElementById('new-match-mode');
  for (const id of ['new-match-name-a-single', 'new-match-name-b-single']) document.getElementById(id).value = '';
  toggleMatchModeInputs(modeSel ? modeSel.value : 'doubles');
  document.getElementById('new-match-modal').classList.remove('hidden');
}

function populateNewMatchPlayerDropdowns() {
  const selectIds = [
    'match-player-a-single', 'match-player-b-single',
    'match-doubles-a1', 'match-doubles-a2',
    'match-doubles-b1', 'match-doubles-b2'
  ];

  const optionsHtml = '<option value="">-- Pilih dari Daftar Pemain --</option>' +
    (AppState.players || []).map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} (${escapeHTML(p.level || p.skill_level || 'Intermediate')})</option>`).join('');

  selectIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = optionsHtml;
    }
  });

  syncSinglePlayerName('a');
  syncSinglePlayerName('b');
  autoGenerateDoublesTeamName('a');
  autoGenerateDoublesTeamName('b');
}

function toggleMatchModeInputs(modeVal) {
  const mode = modeVal || document.getElementById('new-match-mode')?.value || 'doubles';
  const singlesWrap = document.getElementById('match-inputs-singles');
  const doublesWrap = document.getElementById('match-inputs-doubles');

  if (mode === 'singles') {
    singlesWrap?.classList.remove('hidden');
    doublesWrap?.classList.add('hidden');
    syncSinglePlayerName('a');
    syncSinglePlayerName('b');
  } else {
    singlesWrap?.classList.add('hidden');
    doublesWrap?.classList.remove('hidden');
    autoGenerateDoublesTeamName('a');
    autoGenerateDoublesTeamName('b');
  }
}

function syncSinglePlayerName(teamKey) {
  const selectEl = document.getElementById(`match-player-${teamKey}-single`);
  const inputEl = document.getElementById(`new-match-name-${teamKey}-single`);
  if (!selectEl || !inputEl) return;
  const p = (AppState.players || []).find(x => x.id === selectEl.value);
  if (p) inputEl.value = p.name;
}

function autoGenerateDoublesTeamName(teamKey) {
  const sel1 = document.getElementById(`match-doubles-${teamKey}1`);
  const sel2 = document.getElementById(`match-doubles-${teamKey}2`);
  const teamNameInput = document.getElementById(`new-match-team-name-${teamKey}`);
  if (!sel1 || !sel2 || !teamNameInput) return;

  const p1 = (AppState.players || []).find(x => x.id === sel1.value);
  const p2 = (AppState.players || []).find(x => x.id === sel2.value);

  teamNameInput.value = p1 && p2 ? `${p1.name} & ${p2.name}` : '';
}

function handleGameSelectChange(selectElOrVal, wrapId = 'new-match-custom-game-wrap') {
  const val = typeof selectElOrVal === 'string' ? selectElOrVal : selectElOrVal?.value;
  const wrap = document.getElementById(wrapId);
  if (wrap) wrap.classList.toggle('hidden', val !== 'custom');
}

async function startMatchFromForm(e) {
  if (e) e.preventDefault();

  const selectedCourt = document.getElementById('new-match-court-select').value;
  if (!selectedCourt) return;
  const sport = document.getElementById('new-match-sport')?.value || 'padel';
  const mode = document.getElementById('new-match-mode')?.value || 'doubles';
  const setsToWin = parseInt(document.getElementById('new-match-sets')?.value) || 2;
  const gamesSelectVal = document.getElementById('new-match-games')?.value || '6';
  let gamesPerSet = 6;
  if (gamesSelectVal === 'custom') {
    gamesPerSet = parseInt(document.getElementById('new-match-custom-game')?.value) || 6;
  } else {
    gamesPerSet = parseInt(gamesSelectVal) || 6;
  }

  const deuceRuleRadio = document.querySelector('input[name="match-deuce-rule"]:checked');
  const goldenPoint = deuceRuleRadio ? deuceRuleRadio.value === 'golden_point' : false;

  let teamAName = 'Tim A';
  let teamBName = 'Tim B';
  let teamAPlayers = [];
  let teamBPlayers = [];

  if (mode === 'singles') {
    const pAId = document.getElementById('match-player-a-single')?.value;
    const pBId = document.getElementById('match-player-b-single')?.value;
    const pA = (AppState.players || []).find(x => x.id === pAId);
    const pB = (AppState.players || []).find(x => x.id === pBId);

    teamAName = document.getElementById('new-match-name-a-single').value.trim() || pA?.name;
    teamBName = document.getElementById('new-match-name-b-single').value.trim() || pB?.name;

    teamAPlayers = [pA || { id: '', name: teamAName, photo_url: '' }];
    teamBPlayers = [pB || { id: '', name: teamBName, photo_url: '' }];
  } else {
    const pA1 = (AppState.players || []).find(x => x.id === document.getElementById('match-doubles-a1')?.value);
    const pA2 = (AppState.players || []).find(x => x.id === document.getElementById('match-doubles-a2')?.value);
    const pB1 = (AppState.players || []).find(x => x.id === document.getElementById('match-doubles-b1')?.value);
    const pB2 = (AppState.players || []).find(x => x.id === document.getElementById('match-doubles-b2')?.value);

    const pA1Obj = pA1 || { id: '', name: 'Pemain A1', photo_url: '' };
    const pA2Obj = pA2 || { id: '', name: 'Pemain A2', photo_url: '' };
    const pB1Obj = pB1 || { id: '', name: 'Pemain B1', photo_url: '' };
    const pB2Obj = pB2 || { id: '', name: 'Pemain B2', photo_url: '' };

    teamAPlayers = [pA1Obj, pA2Obj];
    teamBPlayers = [pB1Obj, pB2Obj];

    teamAName = document.getElementById('new-match-team-name-a')?.value.trim() || (pA1 && pA2 && `${pA1.name} & ${pA2.name}`);
    teamBName = document.getElementById('new-match-team-name-b')?.value.trim() || (pB1 && pB2 && `${pB1.name} & ${pB2.name}`);
  }

  const names = [...teamAPlayers, ...teamBPlayers].map(player => player.id).filter(Boolean);
  if (new Set(names).size !== names.length) {
    showToast('Pemain yang sama hanya bisa dipilih sekali.');
    return;
  }
  if (!teamAName || !teamBName || teamAName.toLowerCase() === teamBName.toLowerCase()) {
    showToast('Pilih pemain atau isi dua nama tim yang berbeda.');
    return;
  }

  const response = await startSharedMatch(selectedCourt, {
    sport, mode,
    team_a_name: teamAName, team_b_name: teamBName,
    team_a_players: teamAPlayers, team_b_players: teamBPlayers,
    rules: {
      sets_to_win: setsToWin, games_per_set: gamesPerSet, golden_point: goldenPoint,
      tiebreak_at: gamesPerSet, tiebreak_points: 7
    }
  });
  if (response) document.getElementById('new-match-modal').classList.add('hidden');
}

function matchPlayer(player) {
  return { id: player.id, name: player.name };
}

async function startSharedMatch(courtId, config) {
  const response = await runCourtRequest(courtId, 'start', {
    ...config,
    id: 'm_' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 14)),
    team_a_players: config.team_a_players.map(matchPlayer),
    team_b_players: config.team_b_players.map(matchPlayer)
  });
  if (response) {
    handleCourtSwitch(courtId);
    switchTab('scorer');
    showToast(`🎾 Pertandingan dimulai di ${getCourtDisplayName(courtId)}!`);
  }
  return response;
}

// ============================================================================
// 9. ADMIN COMMAND CENTER (SUPERVISION, ANALYTICS, FULL AUDIT & REMOTE CONTROL)
// ============================================================================
async function refreshAdminDashboard(showNotification = false) {
  const success = await fetchBootstrapData();
  if (showNotification) showToast(success ? '✅ Data Admin diperbarui.' : 'Koneksi ke database terputus.');
}

function renderAdminDashboard() {
  renderAdminKpiCards();
  renderAdminLiveCourts();
  renderAdminVisualAnalytics();
  renderAdminPlayersTable();
  renderAdminMatchesExplorer();
  renderAdminUsersList();
}

function renderAdminKpiCards() {
  const kpiGrid = document.getElementById('admin-kpi-grid');
  if (!kpiGrid) return;

  const matches = (AppState.matches || []).filter(match => match.status === 'completed');
  const players = AppState.players || [];
  const courts = AppState.courts || [];
  const tournaments = AppState.tournaments || [];

  const totalMatches = matches.length;
  const padelMatches = matches.filter(m => (m.sport || 'padel').toLowerCase() === 'padel').length;
  const tennisMatches = totalMatches - padelMatches;

  const liveCourtsCount = courts.filter(c => c.active_match && !c.active_match.is_completed && c.active_match.status !== 'completed').length;

  let totalSets = 0;
  let totalGames = 0;
  let totalMinutes = 0;
  let walkovers = 0;

  matches.forEach(m => {
    const sets = m.sets_history || [];
    totalSets += sets.length;
    sets.forEach(st => {
      totalGames += (parseInt(st.team_a) || 0) + (parseInt(st.team_b) || 0);
    });
    totalMinutes += (parseInt(m.duration_minutes) || 0);
    if (m.win_type && m.win_type !== 'normal') walkovers++;
  });

  const avgDuration = totalMatches > 0 ? Math.round(totalMinutes / totalMatches) : 0;
  const activeTours = tournaments.filter(t => t.status !== 'completed').length;

  const cards = [
    {
      icon: '🎾',
      label: 'Total Match Selesai',
      value: totalMatches,
      sub: `${padelMatches} Padel • ${tennisMatches} Tenis`,
      color: 'text-emerald-400',
      border: 'border-emerald-500/30'
    },
    {
      icon: '🏟️',
      label: 'Lapangan Aktif Live',
      value: liveCourtsCount,
      sub: `Dari ${Math.max(3, courts.length)} Lapangan`,
      color: 'text-blue-400',
      border: 'border-blue-500/30'
    },
    {
      icon: '👥',
      label: 'Total Pemain Roster',
      value: players.length,
      sub: `${(AppState.users || []).length} Sesi Login Tercatat`,
      color: 'text-amber-400',
      border: 'border-amber-500/30'
    },
    {
      icon: '📊',
      label: 'Total Set / Game',
      value: `${totalSets} / ${totalGames}`,
      sub: 'Akumulasi Seluruh Match',
      color: 'text-purple-400',
      border: 'border-purple-500/30'
    },
    {
      icon: '⏱️',
      label: 'Rata-rata Durasi',
      value: `${avgDuration}m`,
      sub: `Total ${totalMinutes} menit bermain`,
      color: 'text-sky-400',
      border: 'border-sky-500/30'
    },
    {
      icon: '🏆',
      label: 'Turnamen & W.O.',
      value: tournaments.length,
      sub: `${activeTours} Aktif • ${walkovers} W.O./DQ`,
      color: 'text-rose-400',
      border: 'border-rose-500/30'
    }
  ];

  kpiGrid.innerHTML = cards.map(c => `
    <div class="bg-slate-900 border ${c.border} rounded-2xl p-3.5 sm:p-4 shadow-lg card-sunlight flex flex-col justify-between">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold text-slate-400 uppercase">${c.label}</span>
        <span class="text-lg">${c.icon}</span>
      </div>
      <div class="text-2xl sm:text-3xl font-black font-mono ${c.color} my-1">${c.value}</div>
      <div class="text-[10px] text-slate-400 truncate">${c.sub}</div>
    </div>
  `).join('');
}

function renderAdminLiveCourts() {
  document.getElementById('admin-live-courts-grid').innerHTML = AppState.courts
    .map(court => buildCourtMonitorCardHTML(court, true)).join('');
}

async function handleAdminClearCourt(courtId) {
  const match = AppState.courts.find(court => court.id === courtId)?.active_match;
  if (!match || !confirm(`Kosongkan ${getCourtDisplayName(courtId)} tanpa menyimpan hasil pertandingan ini?`)) return;
  const response = await runCourtRequest(courtId, 'clear', { match_id: match.id, version: match.version });
  if (response) showToast(`🧹 ${getCourtDisplayName(courtId)} dikosongkan.`);
}

function renderAdminVisualAnalytics() {
  const matches = (AppState.matches || []).filter(match => match.status === 'completed');
  const total = matches.length || 1;

  const padelCount = matches.filter(m => (m.sport || 'padel').toLowerCase() === 'padel').length;
  const tennisCount = matches.length - padelCount;
  const doublesCount = matches.filter(m => (m.mode || 'doubles') === 'doubles').length;
  const singlesCount = matches.length - doublesCount;
  const goldenCount = matches.filter(m => m.rules?.golden_point).length;
  const deuceCount = matches.length - goldenCount;

  const distContainer = document.getElementById('admin-distribution-stats');
  if (distContainer) {
    const barRow = (labelLeft, countLeft, labelRight, countRight, colorLeft, colorRight) => {
      const pctLeft = matches.length > 0 ? Math.round((countLeft / total) * 100) : 50;
      const pctRight = 100 - pctLeft;
      return `
        <div>
          <div class="flex justify-between text-xs font-bold mb-1">
            <span class="${colorLeft.text}">${labelLeft}: ${countLeft} (${pctLeft}%)</span>
            <span class="${colorRight.text}">${labelRight}: ${countRight} (${pctRight}%)</span>
          </div>
          <div class="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex">
            <div style="width: ${pctLeft}%" class="${colorLeft.bg} h-full transition-all duration-500"></div>
            <div style="width: ${pctRight}%" class="${colorRight.bg} h-full transition-all duration-500"></div>
          </div>
        </div>
      `;
    };

    distContainer.innerHTML = [
      barRow('🎾 Padel', padelCount, '🎾 Tenis', tennisCount, { text: 'text-emerald-400', bg: 'bg-emerald-500' }, { text: 'text-sky-400', bg: 'bg-sky-500' }),
      barRow('👥 Ganda (2v2)', doublesCount, '👤 Tunggal (1v1)', singlesCount, { text: 'text-amber-400', bg: 'bg-amber-500' }, { text: 'text-indigo-400', bg: 'bg-indigo-500' }),
      barRow('⭐ Golden Point', goldenCount, '🎾 Deuce Normal', deuceCount, { text: 'text-yellow-400', bg: 'bg-yellow-500' }, { text: 'text-teal-400', bg: 'bg-teal-500' })
    ].join('');
  }

  // Top 5 Leaderboard
  const topContainer = document.getElementById('admin-top-players-chart');
  if (topContainer) {
    const enrichedPlayers = getPlayersWithDetailedStats();
    const top5 = [...enrichedPlayers]
      .sort((a, b) => (b.wins - a.wins) || (b.winRate - a.winRate) || (b.gameDiff - a.gameDiff))
      .slice(0, 5);

    if (top5.length === 0) {
      topContainer.innerHTML = '<p class="text-xs text-slate-500 italic">Belum ada data pemain.</p>';
    } else {
      const maxWins = Math.max(1, top5[0]?.wins || 1);
      topContainer.innerHTML = top5.map((p, idx) => {
        const pctWidth = Math.max(12, Math.round((p.wins / maxWins) * 100));
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        return `
          <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800/90 flex items-center space-x-3">
            <span class="text-base font-black w-6 text-center">${medal}</span>
            <img src="${escapeHTML(resolvePlayerPhoto(p, p.name))}" class="w-9 h-9 rounded-xl object-cover border border-slate-700">
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between text-xs font-bold mb-1">
                <span class="text-white truncate">${escapeHTML(p.name)}</span>
                <span class="text-emerald-400 font-mono">${p.wins}W - ${p.losses}L (${p.winRate}%)</span>
              </div>
              <div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div style="width: ${pctWidth}%" class="h-full bg-gradient-to-r from-emerald-500 to-amber-400 rounded-full"></div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Compute comprehensive per-player analytics from AppState.matches + AppState.players
function getPlayersWithDetailedStats() {
  const players = AppState.players || [];
  const matches = AppState.matches || [];

  return players.map(p => {
    let matchesPlayed = 0;
    let wins = 0;
    let losses = 0;
    let setsWon = 0;
    let setsLost = 0;
    let gamesWon = 0;
    let gamesLost = 0;
    const recentForm = []; // 'W' or 'L'

    const pNameLower = (p.name || '').trim().toLowerCase();

    matches.forEach(m => {
      if (m.status !== 'completed' || !m.winner) return;
      const inTeamA = (m.team_a_players || []).some(tp => tp.id === p.id || (tp.name || '').trim().toLowerCase() === pNameLower) ||
                      (m.team_a_player_ids || []).includes(p.id) ||
                      (m.team_a_name || '').trim().toLowerCase() === pNameLower;
      const inTeamB = (m.team_b_players || []).some(tp => tp.id === p.id || (tp.name || '').trim().toLowerCase() === pNameLower) ||
                      (m.team_b_player_ids || []).includes(p.id) ||
                      (m.team_b_name || '').trim().toLowerCase() === pNameLower;

      if (!inTeamA && !inTeamB) return;

      matchesPlayed++;
      const isWinner = (inTeamA && m.winner === 'team_a') || (inTeamB && m.winner === 'team_b');
      if (isWinner) {
        wins++;
        if (recentForm.length < 5) recentForm.push('W');
      } else if (m.winner) {
        losses++;
        if (recentForm.length < 5) recentForm.push('L');
      }

      (m.sets_history || []).forEach(st => {
        const ga = parseInt(st.team_a) || 0;
        const gb = parseInt(st.team_b) || 0;
        const setWinner = st.partial ? null : st.winner || (ga > gb ? 'team_a' : gb > ga ? 'team_b' : null);
        if (inTeamA) {
          gamesWon += ga;
          gamesLost += gb;
          if (setWinner === 'team_a') setsWon++;
          else if (setWinner === 'team_b') setsLost++;
        } else {
          gamesWon += gb;
          gamesLost += ga;
          if (setWinner === 'team_b') setsWon++;
          else if (setWinner === 'team_a') setsLost++;
        }
      });
    });

    const storedWins = p.wins !== undefined ? p.wins : (p.matches_won || 0);
    const storedLosses = p.losses !== undefined ? p.losses : (p.matches_lost || 0);
    const finalMatches = matchesPlayed || p.matches_played || (storedWins + storedLosses) || 0;
    const finalWins = matchesPlayed > 0 ? wins : storedWins;
    const finalLosses = matchesPlayed > 0 ? losses : storedLosses;
    const winRate = finalMatches > 0 ? Math.round((finalWins / finalMatches) * 100) : 0;

    return {
      ...p,
      level: p.level || p.skill_level || 'Intermediate',
      skill_level: p.skill_level || p.level || 'Intermediate',
      matches_played: finalMatches,
      wins: finalWins,
      losses: finalLosses,
      winRate,
      setsWon: matchesPlayed > 0 ? setsWon : p.sets_won || 0,
      setsLost: matchesPlayed > 0 ? setsLost : p.sets_lost || 0,
      gamesWon: matchesPlayed > 0 ? gamesWon : p.games_won || 0,
      gamesLost: matchesPlayed > 0 ? gamesLost : p.games_lost || 0,
      gameDiff: matchesPlayed > 0 ? gamesWon - gamesLost : (p.games_won || 0) - (p.games_lost || 0),
      recentForm
    };
  });
}

function renderAdminPlayersTable() {
  const tbody = document.getElementById('admin-players-table-body');
  if (!tbody) return;

  const searchQ = (document.getElementById('admin-player-search')?.value || '').trim().toLowerCase();
  const levelFilter = document.getElementById('admin-player-level-filter')?.value || 'all';
  const sortBy = document.getElementById('admin-player-sort')?.value || 'wins';

  let list = getPlayersWithDetailedStats();
  if (levelFilter !== 'all') {
    list = list.filter(p => (p.level || '').toLowerCase() === levelFilter.toLowerCase());
  }
  if (searchQ) {
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(searchQ) ||
      (p.nickname || '').toLowerCase().includes(searchQ) ||
      (p.level || '').toLowerCase().includes(searchQ)
    );
  }

  list.sort((a, b) => {
    if (sortBy === 'winrate') return (b.winRate - a.winRate) || (b.wins - a.wins);
    if (sortBy === 'played') return (b.matches_played - a.matches_played) || (b.wins - a.wins);
    if (sortBy === 'gamediff') return (b.gameDiff - a.gameDiff) || (b.gamesWon - a.gamesWon);
    return (b.wins - a.wins) || (b.winRate - a.winRate) || (b.gameDiff - a.gameDiff);
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="p-6 text-center text-slate-500">Tidak ada pemain yang cocok dengan pencarian.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((p, idx) => {
    const formBadges = p.recentForm.length > 0
      ? p.recentForm.map(r => `<span class="inline-block w-5 h-5 leading-5 text-center rounded text-[10px] font-black ${r === 'W' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-red-500/20 text-red-400 border border-red-500/40'}">${r}</span>`).join(' ')
      : '<span class="text-slate-600 text-[10px]">Belum main</span>';

    const diffStr = p.gameDiff > 0 ? `+${p.gameDiff}` : `${p.gameDiff}`;

    return `
      <tr class="hover:bg-slate-800/50 transition">
        <td class="p-3 font-mono font-bold text-slate-400">#${idx + 1}</td>
        <td class="p-3">
          <div class="flex items-center space-x-2.5">
            <img src="${escapeHTML(resolvePlayerPhoto(p, p.name))}" class="w-9 h-9 rounded-xl object-cover border border-slate-700">
            <div>
              <div class="font-bold text-white">${escapeHTML(p.name)}</div>
              <div class="text-[10px] text-slate-400 truncate max-w-[150px]">${p.slogan_text ? `🔊 "${p.slogan_text}"` : 'Tanpa slogan'}</div>
            </div>
          </div>
        </td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-bold text-emerald-400">${escapeHTML(p.level)}</span>
          <span class="text-[10px] text-slate-400 ml-1">${p.hand || 'Kanan'}</span>
        </td>
        <td class="p-3 text-center font-mono font-bold text-white">${p.matches_played}</td>
        <td class="p-3 text-center font-mono font-bold text-emerald-400">${p.wins}</td>
        <td class="p-3 text-center font-mono font-bold text-red-400">${p.losses}</td>
        <td class="p-3 text-center font-mono text-slate-300">${p.setsWon} - ${p.setsLost}</td>
        <td class="p-3 text-center font-mono text-slate-300">
          ${p.gamesWon} - ${p.gamesLost}
          <span class="text-[10px] ml-1 ${p.gameDiff >= 0 ? 'text-emerald-400' : 'text-red-400'}">(${diffStr})</span>
        </td>
        <td class="p-3">
          <span class="font-mono font-black ${p.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}">${p.winRate}%</span>
        </td>
        <td class="p-3 text-center whitespace-nowrap">${formBadges}</td>
        <td class="p-3 text-right whitespace-nowrap">
          <button onclick="editPlayer(${htmlArgument(p.id)})" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold mr-1">✏️</button>
          <button onclick="deletePlayer(${htmlArgument(p.id)})" class="px-2.5 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-[11px] font-bold">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminMatchesExplorer() {
  const container = document.getElementById('admin-matches-explorer-list');
  if (!container) return;

  const q = (document.getElementById('admin-match-search')?.value || '').trim().toLowerCase();
  const sportFilter = document.getElementById('admin-match-sport-filter')?.value || 'all';
  const modeFilter = document.getElementById('admin-match-mode-filter')?.value || 'all';
  const statusFilter = document.getElementById('admin-match-status-filter')?.value || 'all';

  const filtered = (AppState.matches || []).filter(m => {
    if (sportFilter !== 'all' && (m.sport || 'padel').toLowerCase() !== sportFilter) return false;
    if (modeFilter !== 'all' && (m.mode || 'doubles').toLowerCase() !== modeFilter) return false;
    if (statusFilter === 'normal' && m.win_type && m.win_type !== 'normal') return false;
    if (statusFilter === 'wo_dq' && (!m.win_type || m.win_type === 'normal')) return false;
    if (q) {
      const hay = `${m.team_a_name || ''} ${m.team_b_name || ''} ${m.winner_name || ''} ${m.win_reason || ''} ${m.scored_by?.name || ''} ${m.tournament_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl">Tidak ada riwayat pertandingan yang sesuai filter.</div>`;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const setsStr = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(' | ');
    const winA = m.status !== 'replayed' && m.winner === 'team_a';
    const winB = m.status !== 'replayed' && m.winner === 'team_b';
    const isDoubles = m.mode === 'doubles';
    const courtName = getCourtDisplayName(m.court_id || 'court_1');
    const refName = m.scored_by?.name || 'Wasit';
    const totalPts = (m.stats?.total_points_a || 0) + (m.stats?.total_points_b || 0);
    const dateStr = m.created_at || m.date || '-';

    return `
      <div class="p-4 bg-slate-950/80 hover:bg-slate-950 rounded-2xl border border-slate-800 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 transition">
        <div class="space-y-1.5 flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded font-bold uppercase">${escapeHTML(m.sport || 'PADEL')}</span>
            <span class="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 rounded font-bold uppercase">${isDoubles ? '👥 2v2' : '👤 1v1'}</span>
            <span class="px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-semibold">🏟️ ${escapeHTML(courtName)}</span>
            ${m.status === 'replayed' ? '<span class="text-amber-300 font-bold">Hasil lama · pertandingan diulang</span>' : ''}
            ${m.win_type && m.win_type !== 'normal' ? `<span class="px-2 py-0.5 bg-red-500/20 text-red-300 border border-red-500/40 rounded font-bold">${escapeHTML(m.win_reason || 'W.O. / DQ')}</span>` : ''}
            <span class="text-slate-400">📅 ${escapeHTML(dateStr)}</span>
            <span class="text-slate-400">⏱️ ${escapeHTML(m.duration_minutes || 1)}m</span>
            <span class="text-slate-400">👤 Wasit: <strong class="text-slate-300">${escapeHTML(refName)}</strong></span>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-base sm:text-lg font-bold">
            <span class="${winA ? 'text-emerald-400' : 'text-slate-300'}">${escapeHTML(m.team_a_name)} ${winA ? '🏆' : ''}</span>
            <span class="text-slate-600 text-xs font-black">VS</span>
            <span class="${winB ? 'text-amber-400' : 'text-slate-300'}">${escapeHTML(m.team_b_name)} ${winB ? '🏆' : ''}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 self-end lg:self-center">
          <div class="text-right">
            <div class="px-3.5 py-1.5 bg-slate-900 rounded-xl border border-slate-700 font-mono font-black text-base text-white">
              ${escapeHTML(setsStr || '0-0')}
            </div>
            ${totalPts > 0 ? `<div class="text-[10px] text-slate-400 font-mono mt-0.5">Total Poin: ${escapeHTML(m.stats.total_points_a)}-${escapeHTML(m.stats.total_points_b)}</div>` : ''}
          </div>

          <div class="flex items-center space-x-1.5">
            ${m.resumable && canScoreMatch(m) ? `<button onclick="resumeMatch(${htmlArgument(m.id)})" class="p-2 bg-blue-700 rounded-xl text-xs font-bold">▶ Lanjutkan</button>` : ''}
          <button onclick="openMatchDetailModal(${htmlArgument(m.id)})" class="px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-xl text-xs font-bold transition">
              🔍 Detail / Edit
            </button>
            <button onclick="deleteMatchHistory(${htmlArgument(m.id)})" class="px-2.5 py-2 bg-red-600/15 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/30 rounded-xl text-xs font-bold transition" title="Hapus Match">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAdminUsersList() {
  const container = document.getElementById('admin-users-list');
  const badgeEl = document.getElementById('admin-users-count-badge');
  if (!container) return;

  const users = AppState.users || [];
  if (badgeEl) badgeEl.textContent = `${users.length} Akun`;

  if (users.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 italic col-span-full">Belum ada riwayat sesi login yang tercatat di server.</p>`;
    return;
  }

  container.innerHTML = users.map(u => {
    const isAdmin = u.role === 'admin';
    return `
      <div class="p-3 bg-slate-950/80 rounded-2xl border ${isAdmin ? 'border-blue-500/40' : 'border-slate-800'} flex items-center space-x-3">
        <img src="${escapeHTML(u.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.name || 'User')}`)}" class="w-10 h-10 rounded-xl object-cover border border-slate-700">
        <div class="flex-1 min-w-0">
          <div class="flex items-center space-x-1.5">
            <span class="text-xs font-bold text-white truncate">${escapeHTML(u.name || 'User')}</span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${isAdmin ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-emerald-500/20 text-emerald-300'}">${isAdmin ? '🛡️ ADMIN' : '🎾 MEMBER'}</span>
          </div>
          <div class="text-[10px] text-slate-400 truncate">${escapeHTML(u.email || '-')}</div>
          <div class="text-[9px] text-slate-500 mt-0.5">Login: ${escapeHTML(u.last_login || '-')} (${escapeHTML(u.login_count || 1)}x)</div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleAdminRecalculateStats() {
  showToast('🔄 Menghitung ulang statistik seluruh pemain dari riwayat match...');
  const res = await apiPost('/api/admin/recalculate-stats', {});
  if (res && (res.status === 'ok' || res.status === 'success')) {
    if (Array.isArray(res.players)) AppState.players = res.players;
    renderAdminDashboard();
    renderPlayersTab();
    showToast('✅ Statistik seluruh pemain berhasil disinkronkan!');
  } else {
    showToast(res?.error || 'Statistik gagal diperbarui.');
  }
}

async function handleAdminBackupJSON() {
  showToast('💾 Mengunduh backup database JSON...');
  const backup = await apiGet('/api/admin/backup');
  if (!backup) {
    showToast('Backup gagal. Periksa koneksi ke database.');
    return;
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DF_Scoring_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('✅ File Backup JSON berhasil diunduh!');
}

async function handleAdminRestoreJSON(fileOrEvent) {
  const file = fileOrEvent?.target ? fileOrEvent.target.files?.[0] : fileOrEvent;
  if (!file) return;

  if (!confirm(`Restore database dari file "${file.name}"? Data saat ini akan diperbarui.`)) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const res = await apiPost('/api/admin/restore', payload);
    if (res?.status === 'success') {
      await refreshAdminDashboard(false);
      renderAll();
      showToast('✅ Restore database JSON berhasil!');
    } else {
      showToast(res?.error || 'Gagal melakukan restore database.');
    }
  } catch (err) {
    alert('File JSON tidak valid: ' + err.message);
  }
}

// ============================================================================
// 10. MATCH DETAIL INSPECTOR & ADMIN SCORE CORRECTION MODAL
// ============================================================================
function openMatchDetailModal(matchId) {
  const m = (AppState.matches || []).find(x => x.id === matchId);
  if (!m) {
    showToast('Data pertandingan tidak ditemukan.');
    return;
  }

  const bodyEl = document.getElementById('modal-match-detail-body');
  const subtitleEl = document.getElementById('detail-match-subtitle');
  const modal = document.getElementById('modal-match-detail');
  if (!bodyEl || !modal) return;

  const dateStr = m.created_at || m.date || '-';
  if (subtitleEl) {
    subtitleEl.textContent = `${getCourtDisplayName(m.court_id || 'court_1')} • ${(m.sport || 'Padel').toUpperCase()} • ${dateStr}`;
  }

  const setsStr = (m.sets_history || []).map((s, i) => `Set ${i + 1}: ${s.team_a}-${s.team_b}`).join(' • ');
  const setsInputDefault = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(', ');
  const st = m.stats || {};
  const pointLog = m.point_log || [];
  const isAdmin = AppState.currentUser?.role === 'admin';

  bodyEl.innerHTML = `
    <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>🏟️ <strong>${escapeHTML(getCourtDisplayName(m.court_id || 'court_1'))}</strong> • ${escapeHTML((m.sport || 'Padel').toUpperCase())} (${m.mode === 'doubles' ? 'Ganda 2v2' : 'Tunggal 1v1'})</span>
        <span>📅 ${escapeHTML(dateStr)} • ⏱️ ${escapeHTML(m.duration_minutes || 1)} Menit</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center text-center py-2">
        <div class="p-3 rounded-xl ${m.winner === 'team_a' ? 'bg-emerald-950/50 border border-emerald-500/40' : 'bg-slate-900 border border-slate-800'}">
          <div class="text-xs text-slate-400 font-bold">TIM A ${m.winner === 'team_a' ? '🏆 WINNER' : ''}</div>
          <div class="text-base font-black text-white mt-0.5">${escapeHTML(m.team_a_name)}</div>
        </div>
        <div class="font-mono font-black text-xl text-amber-400">
          ${escapeHTML((m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(' | ') || '0-0')}
        </div>
        <div class="p-3 rounded-xl ${m.winner === 'team_b' ? 'bg-amber-950/50 border border-amber-500/40' : 'bg-slate-900 border border-slate-800'}">
          <div class="text-xs text-slate-400 font-bold">TIM B ${m.winner === 'team_b' ? '🏆 WINNER' : ''}</div>
          <div class="text-base font-black text-white mt-0.5">${escapeHTML(m.team_b_name)}</div>
        </div>
      </div>

      <div class="text-xs text-center text-slate-400 font-mono">${escapeHTML(setsStr || 'Tidak ada rincian set')}</div>
      ${m.win_reason ? `<div class="text-xs text-center font-bold text-red-300 bg-red-950/50 py-1.5 px-3 rounded-xl border border-red-500/30">${escapeHTML(m.win_reason)}</div>` : ''}
    </div>

    <!-- Detailed Match Telemetry -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Total Poin</div>
        <div class="text-sm font-mono font-bold text-white mt-0.5">${escapeHTML(st.total_points_a || 0)} - ${escapeHTML(st.total_points_b || 0)}</div>
      </div>
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Deuce / Golden</div>
        <div class="text-sm font-mono font-bold text-amber-400 mt-0.5">${escapeHTML(st.deuces_count || 0)} / ${escapeHTML(st.golden_points_count || 0)}</div>
      </div>
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Streak Maks</div>
        <div class="text-sm font-mono font-bold text-emerald-400 mt-0.5">${escapeHTML(st.max_streak_a || 0)} - ${escapeHTML(st.max_streak_b || 0)}</div>
      </div>
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Wasit Pencatat</div>
        <div class="text-xs font-bold text-sky-400 mt-0.5 truncate">${escapeHTML(m.scored_by?.name || 'Wasit')}</div>
      </div>
    </div>

    ${pointLog.length > 0 ? `
      <div class="p-3 bg-slate-950/70 rounded-2xl border border-slate-800">
        <div class="text-[10px] font-bold text-slate-400 uppercase mb-2">Timeline Poin Terakhir (${pointLog.length} Poin Tercatat)</div>
        <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          ${pointLog.slice(-30).map((pt, i) => `
            <span class="px-2 py-0.5 rounded text-[10px] font-mono ${pt.winner === 'team_a' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'}">
              #${i + 1} ${pt.winner === 'team_a' ? 'A' : 'B'} (${pt.point_score || ''})
            </span>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${isAdmin ? `
      <div class="p-4 bg-blue-950/30 border border-blue-500/40 rounded-2xl space-y-3">
        <div class="text-xs font-black text-blue-300 uppercase flex items-center space-x-1.5">
          <span>🛡️</span>
          <span>Koreksi Skor & Data Pertandingan (Khusus Admin)</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-1">Nama Tim A</label>
            <input type="text" id="admin-corr-team-a" value="${escapeHTML((m.team_a_name || '').replace(/"/g, '&quot;'))}" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-1">Nama Tim B</label>
            <input type="text" id="admin-corr-team-b" value="${escapeHTML((m.team_b_name || '').replace(/"/g, '&quot;'))}" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white">
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-1">Skor Set (pisahkan koma, misal: 6-4, 6-2)</label>
            <input type="text" id="admin-corr-sets" value="${escapeHTML(setsInputDefault)}" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-1">Pemenang</label>
            <select id="admin-corr-winner" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-bold text-emerald-400">
              <option value="team_a" ${m.winner === 'team_a' ? 'selected' : ''}>Tim A Menang</option>
              <option value="team_b" ${m.winner === 'team_b' ? 'selected' : ''}>Tim B Menang</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end">
          <button onclick="handleAdminSaveMatchCorrection(${htmlArgument(m.id)})" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs shadow-lg transition">
            💾 Simpan Koreksi Skor
          </button>
        </div>
      </div>
    ` : ''}
  `;

  modal.classList.remove('hidden');
}

async function handleAdminSaveMatchCorrection(matchId) {
  const teamAName = document.getElementById('admin-corr-team-a')?.value.trim();
  const teamBName = document.getElementById('admin-corr-team-b')?.value.trim();
  const setsRaw = document.getElementById('admin-corr-sets')?.value.trim() || '';
  const winner = document.getElementById('admin-corr-winner')?.value || 'team_a';

  if (!matchId || !teamAName || !teamBName) {
    alert('Nama Tim A dan Tim B wajib diisi!');
    return;
  }

  const parsedSets = [];
  if (setsRaw) {
    setsRaw.split(',').forEach(part => {
      const [ga, gb] = part.trim().split('-').map(n => parseInt(n.trim()) || 0);
      parsedSets.push({
        team_a: ga,
        team_b: gb,
        winner: ga >= gb ? 'team_a' : 'team_b'
      });
    });
  }

  const winnerName = winner === 'team_a' ? teamAName : teamBName;

  const res = await apiPut(`/api/matches/${matchId}`, {
    team_a_name: teamAName,
    team_b_name: teamBName,
    sets_history: parsedSets,
    winner,
    winner_name: winnerName
  });

  if (res && (res.status === 'ok' || res.status === 'updated')) {
    await Promise.all([loadMatches(), loadPlayers()]);
    document.getElementById('modal-match-detail').classList.add('hidden');
    renderAdminDashboard();
    renderHistoryTab();
    showToast('✅ Koreksi skor pertandingan berhasil disimpan & statistik diperbarui!');
  } else {
    showToast(res?.error || 'Gagal menyimpan koreksi pertandingan.');
  }
}

// ============================================================================
// 11. TOURNAMENTS & BRACKETS TAB (1v1 & 2v2 + RESHUFFLE & SWAP)
// ============================================================================
function renderTournamentsList() {
  const listEl = document.getElementById('tournaments-list-container');
  if (!listEl) return;

  if (!AppState.tournaments || AppState.tournaments.length === 0) {
    listEl.innerHTML = `
      <div class="col-span-full p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-400">
        Belum ada turnamen dibuat. Klik <strong>"+ Buat Turnamen"</strong> di kanan atas untuk memulai bagan pertandingan!
      </div>
    `;
    return;
  }

  listEl.innerHTML = AppState.tournaments.map(t => {
    const modeBadge = t.mode === 'doubles' ? '👥 Ganda 2v2' : '👤 Tunggal 1v1';
    return `
      <div class="p-5 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col justify-between hover:border-emerald-500/50 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center space-x-1.5">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">${escapeHTML(t.sport || 'Padel')}</span>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">${modeBadge}</span>
            </div>
            <span class="text-xs text-slate-400 font-semibold">${t.format === 'knockout' ? '🏆 Sistem Gugur' : '🔄 Klasemen Grup'}</span>
          </div>
          <h4 class="text-lg font-extrabold text-white mb-1">${escapeHTML(t.name)}</h4>
          <p class="text-xs text-slate-400 mb-4">${(t.participants || []).length} Peserta • Target ${t.rules?.games_per_set || 6} Game • ${t.rules?.golden_point ? 'Golden Point ⭐' : 'Deuce Normal'}</p>
        </div>
        <div class="flex space-x-2">
          <button onclick="viewTournamentBracket(${htmlArgument(t.id)})" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition">
            Lihat Bagan / Jadwal
          </button>
          ${AppState.currentUser?.role === 'admin' ? `<button onclick="deleteTournament(${htmlArgument(t.id)})" class="px-3 py-2.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-xl text-xs font-bold transition">
            🗑️
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openCreateTournamentModal() {
  if (AppState.dataRevision < 0) {
    showToast('Tunggu sampai data pemain terhubung ke server.');
    return;
  }
  AppState.tourneyDoublesTeams = [];
  populateTournamentParticipantPickers();
  const modeSel = document.getElementById('tourney-mode');
  toggleTourneyModeInputs(modeSel ? modeSel.value : 'doubles');
  document.getElementById('create-tournament-modal').classList.remove('hidden');
}

function toggleTourneyModeInputs(modeVal) {
  const mode = modeVal || document.getElementById('tourney-mode')?.value || 'doubles';
  const singlesWrap = document.getElementById('tourney-singles-picker');
  const doublesWrap = document.getElementById('tourney-doubles-picker');

  if (mode === 'singles') {
    singlesWrap?.classList.remove('hidden');
    doublesWrap?.classList.add('hidden');
  } else {
    singlesWrap?.classList.add('hidden');
    doublesWrap?.classList.remove('hidden');
    renderFormedDoublesTeamsList();
  }
}

function populateTournamentParticipantPickers() {
  const checklistEl = document.getElementById('tourney-participants-list');
  if (checklistEl) {
    checklistEl.innerHTML = (AppState.players || []).map((p, idx) => `
      <label class="flex items-center space-x-2.5 p-2 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-emerald-500/50 transition">
        <input type="checkbox" name="tourney-single-participant" value="${escapeHTML(p.id)}" onchange="updateSinglesSelectedCountBadge()" ${idx < 4 ? 'checked' : ''} class="rounded text-emerald-500 focus:ring-0 w-4 h-4">
        <img src="${escapeHTML(resolvePlayerPhoto(p, p.name))}" class="w-7 h-7 rounded-lg object-cover">
        <div class="truncate">
          <div class="text-xs font-bold text-white truncate">${escapeHTML(p.name)}</div>
          <div class="text-[10px] text-slate-400">${escapeHTML(p.level || p.skill_level || 'Intermediate')}</div>
        </div>
      </label>
    `).join('');
    updateSinglesSelectedCountBadge();
  }

  const p1Sel = document.getElementById('tourney-pair-p1');
  const p2Sel = document.getElementById('tourney-pair-p2');
  const opts = '<option value="">-- Pilih Pemain --</option>' +
    (AppState.players || []).map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} (${escapeHTML(p.level || p.skill_level || 'Intermediate')})</option>`).join('');

  if (p1Sel) p1Sel.innerHTML = opts;
  if (p2Sel) p2Sel.innerHTML = opts;
}

function selectAllSinglesParticipants(selectAll) {
  document.querySelectorAll('input[name="tourney-single-participant"]').forEach(cb => {
    cb.checked = selectAll;
  });
  updateSinglesSelectedCountBadge();
}

function updateSinglesSelectedCountBadge() {
  const count = document.querySelectorAll('input[name="tourney-single-participant"]:checked').length;
  const badge = document.getElementById('singles-selected-count-badge');
  if (badge) badge.textContent = `(${count} Dipilih)`;
}

function addDoublesTeamToTourney() {
  const p1Id = document.getElementById('tourney-pair-p1')?.value;
  const p2Id = document.getElementById('tourney-pair-p2')?.value;
  const customName = document.getElementById('tourney-pair-teamname')?.value.trim();

  if (!p1Id || !p2Id) {
    alert('Pilih Pemain 1 dan Pemain 2 terlebih dahulu!');
    return;
  }
  if (p1Id === p2Id) {
    alert('Pemain 1 dan Pemain 2 tidak boleh orang yang sama!');
    return;
  }

  const alreadyPaired = AppState.tourneyDoublesTeams.some(team => team.players.some(player =>
    player.id === p1Id || player.id === p2Id));
  if (alreadyPaired) {
    showToast('Salah satu pemain sudah terdaftar di pasangan lain.');
    return;
  }
  const p1 = (AppState.players || []).find(x => x.id === p1Id);
  const p2 = (AppState.players || []).find(x => x.id === p2Id);
  if (!p1 || !p2) return;

  const teamName = customName || `${p1.name.split(' ')[0]} & ${p2.name.split(' ')[0]}`;

  AppState.tourneyDoublesTeams.push({
    id: 'team_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    name: teamName,
    mode: 'doubles',
    photo_url: p1.photo_url || '',
    players: [p1, p2],
    slogan_text: p1.slogan_text || p2.slogan_text || '',
    slogan_audio_url: p1.slogan_audio_url || p2.slogan_audio_url || ''
  });

  const nameInput = document.getElementById('tourney-pair-teamname');
  if (nameInput) nameInput.value = '';
  renderFormedDoublesTeamsList();
}

function removeDoublesTeam(teamId) {
  AppState.tourneyDoublesTeams = AppState.tourneyDoublesTeams.filter(t => t.id !== teamId);
  renderFormedDoublesTeamsList();
}

function autoPairDoublesTeams() {
  if (!AppState.players || AppState.players.length < 4) {
    alert('Minimal butuh 4 pemain terdaftar di daftar pemain untuk memasangkan otomatis!');
    return;
  }
  AppState.tourneyDoublesTeams = [];
  const shuffled = [...AppState.players].sort(() => Math.random() - 0.5);

  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const p1 = shuffled[i];
    const p2 = shuffled[i + 1];
    AppState.tourneyDoublesTeams.push({
      id: `team_auto_${i}`,
      name: `${p1.name.split(' ')[0]} & ${p2.name.split(' ')[0]}`,
      mode: 'doubles',
      photo_url: p1.photo_url || '',
      players: [p1, p2],
      slogan_text: p1.slogan_text || p2.slogan_text || '',
      slogan_audio_url: p1.slogan_audio_url || p2.slogan_audio_url || ''
    });
  }
  renderFormedDoublesTeamsList();
  showToast(`🎲 ${AppState.tourneyDoublesTeams.length} Pasangan Ganda berhasil dibentuk otomatis!`);
}

function renderFormedDoublesTeamsList() {
  const listEl = document.getElementById('tourney-doubles-teams-list');
  const countBadge = document.getElementById('tourney-teams-count-badge');
  if (!listEl) return;

  if (countBadge) countBadge.textContent = `${AppState.tourneyDoublesTeams.length} Tim`;

  if (AppState.tourneyDoublesTeams.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-3">Belum ada tim ganda. Pasangkan pemain di atas atau klik 'Pasangkan Otomatis'!</p>`;
    return;
  }

  listEl.innerHTML = AppState.tourneyDoublesTeams.map((t, idx) => {
    const p1 = t.players[0];
    const p2 = t.players[1];
    const img1 = resolvePlayerPhoto(p1, 'P1');
    const img2 = resolvePlayerPhoto(p2, 'P2');
    return `
      <div class="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-700">
        <div class="flex items-center space-x-3">
          <span class="text-xs font-mono font-bold text-amber-400">#${idx + 1}</span>
          <div class="doubles-avatar-wrap">
            <img src="${escapeHTML(img1)}" class="w-8 h-8 rounded-full object-cover border border-amber-400">
            <img src="${escapeHTML(img2)}" class="w-8 h-8 rounded-full object-cover border border-emerald-400">
          </div>
          <div>
            <div class="text-xs font-extrabold text-white">${escapeHTML(t.name)}</div>
            <div class="text-[10px] text-slate-400">${escapeHTML(p1.name)} + ${escapeHTML(p2.name)}</div>
          </div>
        </div>
        <button type="button" onclick="removeDoublesTeam(${htmlArgument(t.id)})" class="text-xs text-red-400 hover:text-red-300 font-bold px-2 py-1">✕ Hapus</button>
      </div>
    `;
  }).join('');
}

async function handleCreateTournament(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('tourney-name')?.value.trim();
  const sport = document.getElementById('tourney-sport')?.value || 'padel';
  const mode = document.getElementById('tourney-mode')?.value || 'doubles';
  const format = document.getElementById('tourney-format')?.value || 'knockout';
  const setsToWin = parseInt(document.getElementById('tourney-sets')?.value) || 2;
  const gamesVal = document.getElementById('tourney-games')?.value || '6';
  const gamesPerSet = gamesVal === 'custom'
    ? (parseInt(document.getElementById('tourney-custom-game')?.value) || 6)
    : (parseInt(gamesVal) || 6);
  const goldenPoint = Boolean(document.getElementById('tourney-golden-point')?.checked);

  let selectedParticipants = [];

  if (mode === 'singles') {
    const checkedIds = Array.from(document.querySelectorAll('input[name="tourney-single-participant"]:checked')).map(el => el.value);
    if (checkedIds.length < 2) {
      alert('Pilih minimal 2 pemain untuk turnamen Tunggal!');
      return;
    }
    selectedParticipants = (AppState.players || []).filter(p => checkedIds.includes(p.id)).map(p => ({
      ...p,
      mode: 'singles',
      players: [p]
    }));
  } else {
    if (AppState.tourneyDoublesTeams.length < 2) {
      alert('Tambahkan minimal 2 Pasangan Ganda untuk memulai turnamen Ganda (2v2)!');
      return;
    }
    selectedParticipants = [...AppState.tourneyDoublesTeams];
  }

  if (!name || selectedParticipants.length < 2) return;
  const participants = selectedParticipants.map(participant => ({
    ...matchPlayer(participant),
    mode,
    players: participant.players.map(matchPlayer)
  }));
  const rules = { sets_to_win: setsToWin, games_per_set: gamesPerSet, golden_point: goldenPoint };
  const tournament = format === 'knockout'
    ? TournamentManager.createKnockoutTournament(name, sport, mode, participants, rules)
    : TournamentManager.createRoundRobinTournament(name, sport, mode, participants, rules);
  const submit = e.currentTarget.querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const response = await apiPost('/api/tournaments', { ...tournament, password: document.getElementById('tourney-password').value });
    if (response?.id) document.getElementById('tourney-password').value = '';
    if (!response?.id || response.error) {
      showToast(response?.error || 'Bagan gagal disimpan. Coba lagi.');
      return;
    }
    AppState.tournaments = [response, ...AppState.tournaments.filter(item => item.id !== response.id)];
    document.getElementById('create-tournament-modal').classList.add('hidden');
    renderTournamentsList();
    viewTournamentBracket(response.id);
    showToast('🏆 Bagan turnamen berhasil dibuat.');
    pollSharedState();
  } finally {
    submit.disabled = false;
  }
}

function viewTournamentBracket(tourneyId) {
  const data = AppState.tournaments.find(t => t.id === tourneyId);
  if (!data) return;
  const tourney = TournamentManager.normalize(data);
  AppState.selectedTournament = tourney;

  const modal = document.getElementById('bracket-modal');
  const titleEl = document.getElementById('bracket-tourn-title');
  const subEl = document.getElementById('bracket-tourn-subtitle');
  if (titleEl) titleEl.textContent = tourney.name;
  if (subEl) {
    subEl.textContent = `${(tourney.sport || 'Padel').toUpperCase()} • ${tourney.mode === 'doubles' ? 'Ganda 2v2' : 'Tunggal 1v1'} • ${tourney.format === 'knockout' ? 'Sistem Gugur' : 'Round Robin'}`;
  }

  document.getElementById('bracket-swap-button').classList.toggle('hidden',
    tourney.format !== 'knockout' || TournamentManager.hasResults(tourney) || AppState.currentUser?.role !== 'admin');
  document.getElementById('bracket-password-button').classList.toggle('hidden', AppState.currentUser?.role !== 'admin');
  if (tourney.champion_name) subEl.textContent += ` • Juara: ${tourney.champion_name}`;
  if (modal) modal.classList.remove('hidden');
  renderBracketContent(tourney);
}

function renderBracketContent(tourney) {
  tourney = tournamentWithLiveScores(tourney);
  const container = document.getElementById('bracket-visual-container');
  if (!container) return;

  if (tourney.format === 'knockout') {
    container.innerHTML = `
      <div class="bracket-container flex space-x-8 overflow-x-auto py-2">
        ${renderKnockoutTree(tourney)}
      </div>
    `;
  } else {
    container.innerHTML = renderRoundRobinView(tourney);
  }
}

function renderKnockoutTree(tourney) {
  return tourney.rounds.map(round => `
    <div class="min-w-[295px] space-y-4">
      <h4 class="text-xs font-extrabold uppercase tracking-wider text-amber-400 bg-slate-800/90 px-3 py-2 rounded-xl text-center border border-slate-700">${escapeHTML(round.name)}</h4>
      <div class="space-y-4 flex flex-col justify-around">
        ${round.matches.map(m => {
          const pA = m.team_a;
          const pB = m.team_b;
          const isReady = TournamentManager.isPlayable(m);
          const winA = m.winner === 'team_a';
          const winB = m.winner === 'team_b';

          return `
            <div class="p-3.5 bg-slate-950 rounded-2xl border ${m.status === 'completed' ? 'border-emerald-500/40' : 'border-slate-800'} space-y-2 shadow-lg">
              <div class="flex items-center justify-between text-[10px] text-slate-500 font-bold">
                <span>MATCH #${escapeHTML(m.match_number)}</span>
                <div class="flex items-center space-x-1">
                  ${m.win_reason ? `<span class="text-red-400 font-extrabold">(${escapeHTML(m.win_reason)})</span>` : ''}
                  <span class="${m.status === 'completed' ? 'text-emerald-400' : 'text-amber-400'}">${escapeHTML(m.status.toUpperCase())}</span>
                </div>
              </div>

              <!-- Participant A -->
              <div class="flex items-center justify-between p-2 rounded-xl ${winA ? 'bg-emerald-950/60 border border-emerald-500/40 font-bold text-emerald-300' : 'bg-slate-900/70 text-slate-300'}">
                <div class="flex items-center space-x-2 truncate">
                  ${renderParticipantAvatar(pA)}
                  <div class="truncate">
                    <div class="text-xs font-bold truncate">${escapeHTML(pA ? pA.name : 'Menunggu...')}</div>
                    ${renderParticipantSubtext(pA)}
                  </div>
                </div>
                ${winA ? '<span>🏆</span>' : ''}
              </div>

              <!-- Participant B -->
              <div class="flex items-center justify-between p-2 rounded-xl ${winB ? 'bg-emerald-950/60 border border-emerald-500/40 font-bold text-emerald-300' : 'bg-slate-900/70 text-slate-300'}">
                <div class="flex items-center space-x-2 truncate">
                  ${renderParticipantAvatar(pB)}
                  <div class="truncate">
                    <div class="text-xs font-bold truncate">${escapeHTML(pB ? pB.name : 'Menunggu...')}</div>
                    ${renderParticipantSubtext(pB)}
                  </div>
                </div>
                ${winB ? '<span>🏆</span>' : ''}
              </div>

              ${m.score_display && m.score_display !== 'vs' ? `<div class="text-center text-xs font-mono text-amber-400 bg-slate-900 py-1 rounded-lg">${escapeHTML(m.score_display)}</div>` : ''}

              ${m.status === 'completed' && pA && pB && !pA.is_bye && !pB.is_bye ? replayButton(tourney.id, m.id) : ''}
              ${isReady ? `
                <div class="grid grid-cols-3 gap-1.5 mt-1">
                  <button onclick="startTournamentMatch(${htmlArgument(tourney.id)}, ${htmlArgument(m.id)})" class="col-span-2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow">
                    ${m.status === 'on play' ? '👁 Lihat Skor / Wasit' : '▶ Mainkan Skor'}
                  </button>
                  <button ${m.status === 'on play' ? 'hidden' : ''} onclick="openBracketWalkoverPrompt(${htmlArgument(tourney.id)}, ${htmlArgument(m.id)})" class="py-2 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 font-bold rounded-xl text-[11px] transition" title="Menang W.O. / Diskualifikasi">
                    🏳️ W.O./DQ
                  </button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function renderParticipantAvatar(p) {
  if (!p || p.is_bye) return `<span class="w-6 h-6 rounded-full bg-slate-800 inline-flex items-center justify-center text-[10px]">-</span>`;
  if (p.mode === 'doubles' && p.players && p.players.length >= 2) {
    const img1 = resolvePlayerPhoto(p.players[0], 'P1');
    const img2 = resolvePlayerPhoto(p.players[1], 'P2');
    return `
      <div class="doubles-avatar-wrap flex-shrink-0">
        <img src="${escapeHTML(img1)}" class="w-6 h-6 rounded-full object-cover border border-emerald-400">
        <img src="${escapeHTML(img2)}" class="w-6 h-6 rounded-full object-cover border border-amber-400">
      </div>
    `;
  }
  const img = resolvePlayerPhoto(p, p.name);
  return `<img src="${escapeHTML(img)}" class="w-6 h-6 rounded-full object-cover flex-shrink-0">`;
}

function renderParticipantSubtext(p) {
  if (!p || p.is_bye) return '';
  if (p.mode === 'doubles' && p.players && p.players.length >= 2) {
    return `<div class="text-[9px] text-slate-400 truncate">${escapeHTML(p.players[0].name)} & ${escapeHTML(p.players[1].name)}</div>`;
  }
  return '';
}

function renderRoundRobinView(tourney) {
  return `
    <div class="space-y-6">
      <!-- Klasemen Table -->
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400 text-xs uppercase">
              <th class="py-2 px-3">#</th>
              <th class="py-2 px-3">Peserta / Tim</th>
              <th class="py-2 px-3 text-center">Main</th>
              <th class="py-2 px-3 text-center">M</th>
              <th class="py-2 px-3 text-center">K</th>
              <th class="py-2 px-3 text-center">Game +/-</th>
              <th class="py-2 px-3 text-center text-emerald-400">Poin</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            ${TournamentManager.calculateStandings(tourney).map((row, i) => `
              <tr class="hover:bg-slate-800/40">
                <td class="py-2.5 px-3 font-bold text-slate-400">${i + 1}</td>
                <td class="py-2.5 px-3 font-bold text-white">${escapeHTML(row.participant.name)}</td>
                <td class="py-2.5 px-3 text-center">${row.played}</td>
                <td class="py-2.5 px-3 text-center text-emerald-400 font-bold">${row.won}</td>
                <td class="py-2.5 px-3 text-center text-red-400">${row.lost}</td>
                <td class="py-2.5 px-3 text-center font-mono">${row.games_won - row.games_lost}</td>
                <td class="py-2.5 px-3 text-center font-extrabold text-amber-400">${row.points}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Jadwal Pertandingan -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        ${tourney.rounds.flatMap(round => round.matches).map((m, index) => `
          <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-2">
            <div class="text-xs font-bold text-slate-400 flex justify-between">
              <span>Match #${index + 1}</span>
              <span class="${m.status === 'completed' ? 'text-emerald-400' : 'text-amber-400'}">${escapeHTML(m.status)}</span>
            </div>
            <div class="text-sm font-bold text-white flex items-center justify-between">
              <span class="truncate max-w-[42%]">${escapeHTML(m.team_a.name)}</span>
              <span class="text-xs text-slate-500">VS</span>
              <span class="truncate max-w-[42%] text-right">${escapeHTML(m.team_b.name)}</span>
            </div>
            ${m.score_display && m.score_display !== 'vs' ? `<div class="text-xs font-mono text-center text-emerald-400 bg-slate-900 py-1 rounded">${escapeHTML(m.score_display)}</div>` : ''}
            ${m.status === 'completed' ? replayButton(tourney.id, m.id) : ''}
            ${m.status !== 'completed' ? `
              <div class="grid grid-cols-3 gap-1.5">
                <button onclick="startTournamentMatch(${htmlArgument(tourney.id)}, ${htmlArgument(m.id)})" class="col-span-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition">
                  ${m.status === 'on play' ? '👁 Lihat Skor / Wasit' : '▶ Mainkan'}
                </button>
                <button ${m.status === 'on play' ? 'hidden' : ''} onclick="openBracketWalkoverPrompt(${htmlArgument(tourney.id)}, ${htmlArgument(m.id)})" class="py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 font-bold rounded-xl text-[11px] transition">
                  🏳️ W.O.
                </button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function startTournamentMatch(tourneyId, matchId) {
  const data = AppState.tournaments.find(tournament => tournament.id === tourneyId);
  if (!data) return;
  const tournament = TournamentManager.normalize(data);
  const fixture = TournamentManager.findMatch(tournament, matchId);
  if (!TournamentManager.isPlayable(fixture)) return;
  const occupied = AppState.courts.find(court => court.active_match?.tournament_id === tourneyId
    && court.active_match.tournament_match_id === matchId);
  if (occupied) {
    if (!await ensureReferee(tourneyId, matchId)) return;
    document.getElementById('bracket-modal').classList.add('hidden');
    switchToCourtAndOpenScorer(occupied.id);
    return;
  }
  if (!await ensureReferee(tourneyId, matchId)) return;
  const courtId = await chooseAvailableCourt();
  if (!courtId) return;
  const games = tournament.rules?.games_per_set || 6;
  const response = await startSharedMatch(courtId, {
    tournament_id: tourneyId, tournament_match_id: matchId,
    sport: tournament.sport || 'padel', mode: tournament.mode || 'singles',
    team_a_name: fixture.team_a.name, team_b_name: fixture.team_b.name,
    team_a_players: fixture.team_a.players || [fixture.team_a],
    team_b_players: fixture.team_b.players || [fixture.team_b],
    rules: {
      sets_to_win: tournament.rules?.sets_to_win || 2, games_per_set: games,
      golden_point: Boolean(tournament.rules?.golden_point), tiebreak_at: games, tiebreak_points: 7
    }
  });
  if (response) document.getElementById('bracket-modal').classList.add('hidden');
}

async function openBracketWalkoverPrompt(tourneyId, matchId) {
  const data = AppState.tournaments.find(tournament => tournament.id === tourneyId);
  if (!data) return;
  const tournament = TournamentManager.normalize(data);
  const fixture = TournamentManager.findMatch(tournament, matchId);
  if (!TournamentManager.isPlayable(fixture)) return;
  if (!await ensureReferee(tourneyId, matchId)) return;
  const choice = prompt(`Pilih pemenang W.O. / DQ:
1. ${fixture.team_a.name}
2. ${fixture.team_b.name}`);
  if (!['1', '2'].includes(choice)) return;
  const reason = prompt('Masukkan alasan (W.O., diskualifikasi, atau cedera).', 'Menang W.O.');
  if (reason === null) return;
  const response = await apiPost('/api/matches', {
    tournament_id: tourneyId, tournament_match_id: matchId,
    sport: tournament.sport, mode: tournament.mode, court_id: AppState.currentCourtId,
    winner: choice === '1' ? 'team_a' : 'team_b',
    win_type: 'walkover', win_reason: reason
  });
  if (!response?.match) {
    showToast(response?.error || 'Hasil gagal disimpan.');
    return;
  }
  await fetchBootstrapData();
  showToast('🏳️ Hasil W.O. tercatat di bagan.');
}

function openSwapBracketModal() {
  if (AppState.currentUser?.role !== 'admin') return;
  const tourney = AppState.selectedTournament;
  if (!tourney || tourney.format !== 'knockout') {
    showToast('Fitur tukar slot hanya untuk turnamen Sistem Gugur (Knockout).');
    return;
  }

  const r1 = tourney.rounds[0];
  const slots = [];
  r1.matches.forEach((m, mIdx) => {
    slots.push({
      key: `${mIdx}_a`,
      label: `Match #${m.match_number} - Slot Atas: ${m.team_a ? m.team_a.name : 'BYE'}`
    });
    slots.push({
      key: `${mIdx}_b`,
      label: `Match #${m.match_number} - Slot Bawah: ${m.team_b ? m.team_b.name : 'BYE'}`
    });
  });

  const optsHtml = slots.map(s => `<option value="${s.key}">${escapeHTML(s.label)}</option>`).join('');
  const sel1 = document.getElementById('swap-slot-1');
  const sel2 = document.getElementById('swap-slot-2');
  if (sel1) sel1.innerHTML = optsHtml;
  if (sel2) {
    sel2.innerHTML = optsHtml;
    if (slots.length > 1) sel2.value = slots[1].key;
  }

  document.getElementById('modal-swap-bracket').classList.remove('hidden');
}

async function confirmSwapParticipants() {
  const tourney = AppState.selectedTournament;
  if (!tourney || tourney.format !== 'knockout') return;

  const key1 = document.getElementById('swap-slot-1').value;
  const key2 = document.getElementById('swap-slot-2').value;
  if (key1 === key2) {
    alert('Pilih 2 slot yang berbeda untuk ditukar!');
    return;
  }

  const [mIdx1, side1] = key1.split('_');
  const [mIdx2, side2] = key2.split('_');

  const updated = structuredClone(tourney);
  const swap = TournamentManager.swapRound1Participants(updated,
    Number(mIdx1), 'team_' + side1, Number(mIdx2), 'team_' + side2);
  if (!swap.success) {
    showToast(swap.message);
    return;
  }
  await saveBracketChanges(updated, '🔄 Posisi peserta berhasil ditukar.');
}

async function handleReshuffleBracket(tourneyId) {
  const data = tourneyId ? AppState.tournaments.find(tournament => tournament.id === tourneyId)
    : AppState.selectedTournament;
  if (!data) return;
  const tournament = TournamentManager.normalize(data);
  if (TournamentManager.hasResults(tournament)) {
    showToast('Bagan sudah memiliki hasil pertandingan.');
    return;
  }
  if (!confirm('Acak ulang posisi peserta di bagan?')) return;
  const participants = [...tournament.participants];
  for (let i = participants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [participants[i], participants[j]] = [participants[j], participants[i]];
  }
  const rebuilt = tournament.format === 'knockout'
    ? TournamentManager.createKnockoutTournament(tournament.name, tournament.sport, tournament.mode, participants, tournament.rules)
    : TournamentManager.createRoundRobinTournament(tournament.name, tournament.sport, tournament.mode, participants, tournament.rules);
  await saveBracketChanges({ ...tournament, rounds: rebuilt.rounds, participants }, '🎲 Bagan berhasil diacak ulang.');
}

async function saveBracketChanges(tournament, message) {
  const response = await apiPut(`/api/tournaments/${tournament.id}`, tournament);
  if (!response?.tournament) {
    showToast(response?.error || 'Perubahan bagan gagal disimpan.');
    return;
  }
  document.getElementById('modal-swap-bracket').classList.add('hidden');
  await fetchBootstrapData();
  viewTournamentBracket(tournament.id);
  showToast(message);
}

async function deleteTournament(id) {
  if (AppState.currentUser?.role !== 'admin') return;
  if (!confirm('Hapus turnamen ini? Lapangan turnamen akan dikosongkan. Riwayat pertandingan tetap disimpan.')) return;
  const response = await apiWrite(`/api/tournaments/${id}`, 'DELETE');
  if (response?.status !== 'deleted') {
    showToast(response?.error || 'Turnamen gagal dihapus.');
    return;
  }
  await loadTournaments();
  renderTournamentsList();
  document.getElementById('bracket-modal')?.classList.add('hidden');
  showToast('🗑️ Turnamen dihapus');
}

// ============================================================================
// 12. PLAYERS & VOICE RECORDING TAB
// ============================================================================
function renderPlayersTab() {
  const grid = document.getElementById('players-grid-container');
  if (!grid) return;

  const enriched = getPlayersWithDetailedStats();

  if (enriched.length === 0) {
    grid.innerHTML = `<div class="col-span-full p-8 bg-slate-900 rounded-2xl border border-slate-800 text-center text-slate-400">Belum ada pemain terdaftar. Klik "+ Tambah Pemain Baru" untuk menambahkan!</div>`;
    return;
  }

  grid.innerHTML = enriched.map(p => {
    const avatar = resolvePlayerPhoto(p, p.name);
    const hasVoice = Boolean(p.slogan_audio_url || p.slogan_text);

    return `
      <div class="p-5 bg-slate-900 rounded-3xl border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition shadow-lg">
        <div class="flex items-center space-x-4">
          <img src="${escapeHTML(avatar)}" class="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/40 bg-slate-800">
          <div class="flex-1 min-w-0">
            <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-slate-800 text-emerald-400 border border-slate-700">${escapeHTML(p.level)}</span>
            <h4 class="text-lg font-extrabold text-white truncate mt-1">${escapeHTML(p.name)}</h4>
            <p class="text-xs text-slate-400">Menang: <strong class="text-emerald-400">${p.wins || 0}</strong> • Kalah: <strong class="text-red-400">${p.losses || 0}</strong> (${p.winRate}%)</p>
          </div>
        </div>

        <div class="p-3 bg-slate-950/90 rounded-2xl border border-slate-800/80 text-xs space-y-2">
          <div class="flex items-center justify-between text-slate-400 font-semibold">
            <span>🔊 Slogan Kemenangan:</span>
            ${hasVoice ? `<button onclick="playPlayerSlogan(${htmlArgument(p.id)})" class="text-emerald-400 hover:underline font-bold">▶ Putar Suara</button>` : '<span class="text-slate-600">Belum ada</span>'}
          </div>
          <p class="italic text-amber-300 font-medium">"${escapeHTML(p.slogan_text || 'Belum mengatur teks slogan')}"</p>
        </div>

        ${AppState.currentUser?.role === 'admin' ? `<div class="flex space-x-2">
          <button onclick="editPlayer(${htmlArgument(p.id)})" class="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition">✏️ Edit / Rekam Suara</button>
          <button onclick="deletePlayer(${htmlArgument(p.id)})" class="px-3 py-2 bg-red-500/10 hover:bg-red-500/30 text-red-400 rounded-xl text-xs font-bold transition">🗑️</button>
        </div>` : ''}
      </div>
    `;
  }).join('');
}

function playPlayerSlogan(id) {
  const player = AppState.players.find(item => item.id === id);
  if (player) window.soundEngine.playVictorySlogan(player, player.name);
}

function openPlayerModal(player = null) {
  if (AppState.currentUser?.role !== 'admin') return;
  document.getElementById('player-form-id').value = player ? player.id : '';
  document.getElementById('player-form-name').value = player ? player.name : '';
  document.getElementById('player-form-nickname').value = player ? (player.nickname || '') : '';
  document.getElementById('player-form-hand').value = player ? (player.handedness || player.hand || 'Kanan') : 'Kanan';
  document.getElementById('player-form-level').value = player ? (player.level || player.skill_level || 'Intermediate') : 'Intermediate';
  document.getElementById('player-form-slogan-text').value = player ? (player.slogan_text || '') : '';
  document.getElementById('player-form-photo-url').value = player ? (player.photo_url || '') : '';
  document.getElementById('player-form-slogan-audio-url').value = player ? (player.slogan_audio_url || '') : '';
  document.getElementById('player-form-notes').value = player ? (player.notes || '') : '';

  const previewImg = document.getElementById('player-photo-preview');
  if (previewImg) {
    previewImg.src = player && player.photo_url ? player.photo_url : 'https://api.dicebear.com/7.x/bottts/svg?seed=NewPlayer';
  }

  const audioPreview = document.getElementById('player-slogan-audio-preview');
  if (audioPreview) {
    if (player && player.slogan_audio_url) {
      audioPreview.src = player.slogan_audio_url;
      audioPreview.classList.remove('hidden');
    } else {
      audioPreview.src = '';
      audioPreview.classList.add('hidden');
    }
  }

  document.getElementById('player-modal').classList.remove('hidden');
}

function compressImageToDataURL(file, maxSize = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxSize) { h = Math.round(h * (maxSize / w)); w = maxSize; }
        } else {
          if (h > maxSize) { w = Math.round(w * (maxSize / h)); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handlePlayerPhotoUpload(fileOrEvent) {
  const file = fileOrEvent?.target ? fileOrEvent.target.files?.[0] : fileOrEvent;
  if (!file) return;

  try {
    showToast('⏳ Memproses foto profil...');
    const base64Img = await compressImageToDataURL(file, 240);
    document.getElementById('player-form-photo-url').value = base64Img;
    document.getElementById('player-photo-preview').src = base64Img;
    showToast('📸 Foto berhasil dipasang!');
  } catch (err) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload/photo', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) {
      document.getElementById('player-form-photo-url').value = data.url;
      document.getElementById('player-photo-preview').src = data.url;
      showToast('📸 Foto berhasil diunggah!');
    }
  }
}

async function toggleVoiceRecording() {
  const btn = document.getElementById('btn-start-record');
  const btnText = document.getElementById('record-btn-text');
  const timerEl = document.getElementById('record-timer');

  if (!AppState.isRecordingVoice) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      AppState.mediaRecorder = new MediaRecorder(stream);
      AppState.audioChunks = [];

      AppState.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) AppState.audioChunks.push(e.data);
      };

      const recorder = AppState.mediaRecorder;
      recorder.onstop = async () => {
        const blob = new Blob(AppState.audioChunks, { type: recorder.mimeType || AppState.audioChunks[0]?.type });
        stream.getTracks().forEach(track => track.stop());
        await uploadRecordedAudioBlob(blob);
      };

      AppState.mediaRecorder.start();
      AppState.isRecordingVoice = true;
      if (btn) btn.classList.add('recording-pulse', 'bg-red-700');
      if (btnText) btnText.textContent = 'Stop Rekam';
      if (timerEl) {
        timerEl.classList.remove('hidden');
        timerEl.textContent = '🔴 Merekam...';
      }
    } catch (err) {
      alert('Gagal mengakses mikrofon. Pastikan izin mikrofon diberikan di browser.');
    }
  } else {
    AppState.mediaRecorder.stop();
    AppState.isRecordingVoice = false;
    if (btn) btn.classList.remove('recording-pulse', 'bg-red-700');
    if (btnText) btnText.textContent = 'Rekam Suara';
    if (timerEl) timerEl.classList.add('hidden');
  }
}

async function uploadRecordedAudioBlob(blob) {
  try {
    const dataUrl = await blobToDataURL(blob);
    document.getElementById('player-form-slogan-audio-url').value = dataUrl;
    const audioPreview = document.getElementById('player-slogan-audio-preview');
    if (audioPreview) {
      audioPreview.src = dataUrl;
      audioPreview.classList.remove('hidden');
    }
    showToast('🎙️ Slogan suara berhasil direkam!');
  } catch (err) {
    const fd = new FormData();
    fd.append('file', blob, 'slogan.webm');
    const res = await fetch('/api/upload/audio', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) {
      document.getElementById('player-form-slogan-audio-url').value = data.url;
      const audioPreview = document.getElementById('player-slogan-audio-preview');
      if (audioPreview) {
        audioPreview.src = data.url;
        audioPreview.classList.remove('hidden');
      }
      showToast('🎙️ Slogan suara berhasil direkam!');
    }
  }
}

async function handleAudioFileUpload(fileOrEvent) {
  const file = fileOrEvent?.target ? fileOrEvent.target.files?.[0] : fileOrEvent;
  if (!file) return;
  await uploadRecordedAudioBlob(file);
}

async function handleSavePlayer(e) {
  if (e) e.preventDefault();
  const id = document.getElementById('player-form-id').value;
  const levelVal = document.getElementById('player-form-level').value;
  const payload = {
    name: document.getElementById('player-form-name').value.trim(),
    nickname: document.getElementById('player-form-nickname').value.trim(),
    handedness: document.getElementById('player-form-hand').value,
    level: levelVal,
    skill_level: levelVal,
    slogan_text: document.getElementById('player-form-slogan-text').value.trim(),
    photo_url: document.getElementById('player-form-photo-url').value,
    slogan_audio_url: document.getElementById('player-form-slogan-audio-url').value,
    notes: document.getElementById('player-form-notes').value.trim()
  };

  const saved = id ? await apiPut(`/api/players/${id}`, payload) : await apiPost('/api/players', payload);
  if (!saved?.id) {
    showToast(saved?.error || 'Profil gagal disimpan.');
    return;
  }

  await loadPlayers();
  populateLoginPlayerPicker();
  document.getElementById('player-modal').classList.add('hidden');
  renderPlayersTab();
  if (AppState.currentTab === 'admin') renderAdminDashboard();
  showToast('✅ Profil pemain berhasil disimpan!');
}

function editPlayer(id) {
  const p = (AppState.players || []).find(x => x.id === id);
  if (p) openPlayerModal(p);
}

async function deletePlayer(id) {
  if (!confirm('Hapus pemain ini dari daftar?')) return;
  const result = await apiWrite(`/api/players/${id}`, 'DELETE');
  if (result?.status !== 'deleted') {
    showToast(result?.error || 'Profil gagal dihapus.');
    return;
  }
  await loadPlayers();
  renderPlayersTab();
  if (AppState.currentTab === 'admin') renderAdminDashboard();
  showToast('🗑️ Pemain dihapus');
}

// ============================================================================
// 13. HISTORY & SETTINGS TABS + MULTI-SHEET EXCEL EXPORT
// ============================================================================
function renderHistoryTab() {
  const container = document.getElementById('history-list-container');
  if (!container) return;

  if (!AppState.matches || AppState.matches.length === 0) {
    container.innerHTML = `<div class="p-8 bg-slate-900 rounded-2xl border border-slate-800 text-center text-slate-400">Belum ada riwayat pertandingan yang selesai.</div>`;
    return;
  }

  container.innerHTML = AppState.matches.map(m => {
    const setsStr = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(' | ');
    const winA = m.status !== 'replayed' && m.winner === 'team_a';
    const winB = m.status !== 'replayed' && m.winner === 'team_b';
    const isDoubles = m.mode === 'doubles';
    const courtName = getCourtDisplayName(m.court_id || 'court_1');
    const dateStr = m.created_at || m.date || '';

    return `
      <div class="p-4 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-slate-700 transition">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-bold uppercase">${escapeHTML(m.sport || 'PADEL')}</span>
            <span class="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 rounded font-bold uppercase">${isDoubles ? '👥 2v2' : '👤 1v1'}</span>
            <span class="px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-semibold">🏟️ ${escapeHTML(courtName)}</span>
            ${m.status === 'replayed' ? '<span class="text-amber-300 font-bold">Hasil lama · pertandingan diulang</span>' : ''}
            ${m.win_type && m.win_type !== 'normal' ? `<span class="px-2 py-0.5 bg-red-500/20 text-red-300 border border-red-500/40 rounded font-bold">${escapeHTML(m.win_reason || 'W.O. / DQ')}</span>` : ''}
            <span class="text-slate-500">${escapeHTML(dateStr)}</span>
            <span class="text-slate-500">• ${escapeHTML(m.duration_minutes || 1)} Menit</span>
          </div>
          <div class="flex items-center space-x-3 text-base sm:text-lg font-bold pt-1">
            <span class="${winA ? 'text-emerald-400' : 'text-slate-300'}">${escapeHTML(m.team_a_name)} ${winA ? '🏆' : ''}</span>
            <span class="text-slate-600 text-xs">VS</span>
            <span class="${winB ? 'text-amber-400' : 'text-slate-300'}">${escapeHTML(m.team_b_name)} ${winB ? '🏆' : ''}</span>
          </div>
        </div>
        <div class="flex items-center space-x-2 self-end sm:self-center">
          <div class="px-4 py-2 bg-slate-950 rounded-xl border border-slate-800 font-mono font-extrabold text-base text-white">
            ${escapeHTML(setsStr || '0-0')}
          </div>
          ${m.resumable && (canScoreMatch(m) || (m.tournament_id && AppState.currentUser)) ? `<button onclick="resumeMatch(${htmlArgument(m.id)})" class="p-2 bg-blue-700 rounded-xl text-xs font-bold">▶ Lanjutkan</button>` : ''}
          <button onclick="openMatchDetailModal(${htmlArgument(m.id)})" class="p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition text-xs font-bold" title="Detail Match">🔍</button>
          ${AppState.currentUser?.role === 'admin'
            ? `<button onclick="deleteMatchHistory(${htmlArgument(m.id)})" class="p-2 text-slate-500 hover:text-red-400 transition" title="Hapus">🗑️</button>`
            : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function deleteMatchHistory(id) {
  if (!confirm('Hapus riwayat pertandingan ini?')) return;
  const result = await apiWrite(`/api/matches/${id}`, 'DELETE');
  if (result?.status !== 'deleted') {
    showToast(result?.error || 'Riwayat gagal dihapus.');
    return;
  }
  await Promise.all([loadMatches(), loadPlayers()]);
  renderHistoryTab();
  if (AppState.currentTab === 'admin') {
    renderAdminDashboard();
  }
}

function renderSettingsTab() {
  if (!AppState.settings) return;
  const whInput = document.getElementById('setting-google-sheet-url');
  const autoCheck = document.getElementById('setting-auto-sync');
  const gcidInput = document.getElementById('setting-google-client-id');
  const voiceSel = document.getElementById('setting-voice-lang');
  const ipEl = document.getElementById('settings-local-ip');

  if (whInput) whInput.value = AppState.settings.google_sheet_url || AppState.settings.google_sheet_webhook_url || '';
  if (autoCheck) autoCheck.checked = AppState.settings.auto_sync_sheets !== false && AppState.settings.auto_sync_sheet !== false;
  if (gcidInput) gcidInput.value = AppState.settings.google_client_id || '';
  if (voiceSel && AppState.settings.voice_lang) voiceSel.value = AppState.settings.voice_lang;
  if (ipEl && AppState.systemInfo?.network_url) ipEl.textContent = AppState.systemInfo.network_url;
}

async function handleSaveSettings(e) {
  if (e) e.preventDefault();
  const sheetUrl = document.getElementById('setting-google-sheet-url')?.value.trim() || '';
  const autoSync = Boolean(document.getElementById('setting-auto-sync')?.checked);
  const clientId = document.getElementById('setting-google-client-id')?.value.trim() || '';
  const voiceLang = document.getElementById('setting-voice-lang')?.value || 'id-ID';

  const payload = {
    google_sheet_url: sheetUrl,
    google_sheet_webhook_url: sheetUrl,
    auto_sync_sheets: autoSync,
    auto_sync_sheet: autoSync,
    google_client_id: clientId,
    voice_lang: voiceLang
  };
  const result = await apiPost('/api/settings', payload);
  if (!result || result.error) {
    showToast(result?.error || 'Gagal menyimpan pengaturan.');
    return;
  }
  await loadSettings();
  renderSettingsTab();
  initGoogleIdentityClient();
  showToast('✅ Pengaturan & Konfigurasi tersimpan!');
}

async function testGoogleSheetConnection() {
  const url = document.getElementById('setting-google-sheet-url')?.value.trim() || '';
  if (!url) {
    alert('Masukkan URL Google Apps Script Webhook terlebih dahulu!');
    return;
  }
  showToast('⏳ Mengirim data tes ke Google Sheet...');
  const res = await apiPost('/api/test-sheet-connection', { google_sheet_url: url });
  if (res && (res.success || res.status === 'success')) {
    showToast('✅ Webhook Google Apps Script merespons.');
  } else {
    alert('Gagal mengirim ke Google Sheet: ' + (res?.error || 'Periksa URL Webhook'));
  }
}

async function triggerBulkSheetSync() {
  showToast('⏳ Menyinkronkan semua riwayat ke Google Sheet...');
  const res = await apiPost('/api/sync-sheets', {});
  if (res && (res.status === 'ok' || res.status === 'success')) {
    showToast(`✅ Berhasil menyinkronkan ${res.synced_count ?? ''} pertandingan ke Google Sheet!`);
  } else {
    alert(res?.error || 'Gagal sinkronisasi. Pastikan URL Google Sheet sudah diisi di tab Pengaturan.');
  }
}

function openSheetTutorialModal() {
  document.getElementById('sheet-tutorial-modal')?.classList.remove('hidden');
}

async function copyAppsScriptCode() {
  try {
    const res = await fetch('/google_apps_script.js');
    const code = await res.text();
    await navigator.clipboard.writeText(code);
    showToast('📋 Kode Google Apps Script berhasil disalin!');
  } catch (e) {
    showToast('Gagal menyalin kode script.');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast-notification');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// Download Multi-Sheet Excel Report (.xlsx)
async function downloadExcelReport() {
  if (!window.XLSX) {
    window.location.href = '/api/export/excel';
    return;
  }

  try {
    showToast('📊 Menyiapkan file Laporan Lengkap Excel (.xlsx)...');
    if (!await fetchBootstrapData()) throw new Error('Database bersama tidak terjangkau.');
    const { matches, tournaments } = AppState;

    const wb = window.XLSX.utils.book_new();

    // Sheet 1: Riwayat Pertandingan
    const matchRows = (matches || AppState.matches || []).map((m, idx) => {
      const sets = m.sets_history || [];
      return {
        'No': idx + 1,
        'Waktu': m.created_at || m.date || '-',
        'Lapangan': getCourtDisplayName(m.court_id || 'court_1'),
        'Olahraga': (m.sport || 'Padel').toUpperCase(),
        'Mode': m.mode === 'doubles' ? 'Ganda (2v2)' : 'Tunggal (1v1)',
        'Tim A': m.team_a_name || 'Tim A',
        'Tim B': m.team_b_name || 'Tim B',
        'Pemenang': m.winner_name || (m.winner === 'team_a' ? m.team_a_name : m.team_b_name) || '-',
        'Status Menang': m.win_reason || 'Normal',
        'Skor Set 1': sets[0] ? `${sets[0].team_a}-${sets[0].team_b}` : '-',
        'Skor Set 2': sets[1] ? `${sets[1].team_a}-${sets[1].team_b}` : '-',
        'Skor Set 3': sets[2] ? `${sets[2].team_a}-${sets[2].team_b}` : '-',
        'Total Poin A': m.stats?.total_points_a || 0,
        'Total Poin B': m.stats?.total_points_b || 0,
        'Durasi (Menit)': m.duration_minutes || 0,
        'Wasit Pencatat': m.scored_by?.name || '-'
      };
    });
    const wsMatches = window.XLSX.utils.json_to_sheet(matchRows.length ? matchRows : [{ Info: 'Belum ada data pertandingan' }]);
    window.XLSX.utils.book_append_sheet(wb, wsMatches, 'Riwayat Pertandingan');

    // Sheet 2: Statistik & Klasemen Pemain
    const detailedPlayers = getPlayersWithDetailedStats();
    const playerRows = detailedPlayers.map((p, idx) => ({
      'Rank': idx + 1,
      'Nama Pemain': p.name,
      'Level': p.level || 'Intermediate',
      'Main': p.matches_played || 0,
      'Menang': p.wins || 0,
      'Kalah': p.losses || 0,
      'Set Menang': p.setsWon || 0,
      'Set Kalah': p.setsLost || 0,
      'Game Menang': p.gamesWon || 0,
      'Game Kalah': p.gamesLost || 0,
      'Selisih Game': p.gameDiff || 0,
      'Win Rate (%)': `${p.winRate}%`,
      'Slogan Kemenangan': p.slogan_text || '-'
    }));
    const wsPlayers = window.XLSX.utils.json_to_sheet(playerRows.length ? playerRows : [{ Info: 'Belum ada data pemain' }]);
    window.XLSX.utils.book_append_sheet(wb, wsPlayers, 'Statistik Pemain');

    // Sheet 3: Daftar Turnamen
    const tourneyRows = (tournaments || AppState.tournaments || []).map((t, idx) => ({
      'No': idx + 1,
      'Nama Turnamen': t.name,
      'Olahraga': (t.sport || 'Padel').toUpperCase(),
      'Mode': t.mode === 'doubles' ? 'Ganda (2v2)' : 'Tunggal (1v1)',
      'Format': t.format === 'knockout' ? 'Knockout (Gugur)' : 'Round Robin (Grup)',
      'Jumlah Peserta': (t.participants || []).length,
      'Status': t.status || 'Active',
      'Tanggal Dibuat': t.created_at || '-'
    }));
    const wsTourneys = window.XLSX.utils.json_to_sheet(tourneyRows.length ? tourneyRows : [{ Info: 'Belum ada turnamen' }]);
    window.XLSX.utils.book_append_sheet(wb, wsTourneys, 'Turnamen');

    const fileName = `Laporan_Master_Padel_Tennis_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    showToast('✅ Laporan Master Excel (.xlsx) berhasil diunduh!');
  } catch (err) {
    window.location.href = '/api/export/excel';
  }
}

function renderAll() {
  updateScoreboardUI(true);
  renderTournamentsList();
  renderPlayersTab();
  renderHistoryTab();
  renderSettingsTab();
  if (AppState.currentUser?.role === 'admin') {
    renderAdminDashboard();
  }
}
