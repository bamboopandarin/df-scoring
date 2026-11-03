/**
 * DF Scoring PRO — Main Application Logic (v3.0)
 * Zero-Lag Local-First Courtside Scoring, Google Member & Admin Authentication,
 * Comprehensive Admin Command Center, Multi-Court Live Sync, Tournament Engine & Google Sheets.
 */

const ADMIN_PASSWORDS = ['12345678910', '1234567890'];

const AppState = {
  currentTab: 'scorer',
  currentCourtId: localStorage.getItem('padel_active_court_id') || 'court_1',
  currentUser: null, // { id, name, email, picture, role: 'admin' | 'member', court_id, player_id }
  loginSelectedRole: 'member',

  scorer: null,
  players: [],
  tournaments: [],
  matches: [],
  courts: [],
  users: [],
  settings: {},
  systemInfo: {},
  selectedTournament: null,

  matchTimerInterval: null,
  matchDurationSecs: 0,
  tourneyDoublesTeams: [],
  modalShown: false,

  // Dirty-check hashes for zero-lag DOM updates
  lastHeaderHashA: '',
  lastHeaderHashB: '',
  lastPointA: '',
  lastPointB: '',

  // Debounced network court sync
  courtSyncTimer: null,
  courtSyncAbortCtrl: null,

  // Voice Slogan Recording
  mediaRecorder: null,
  audioChunks: [],
  isRecordingVoice: false,
  recordTimerInterval: null,
  recordDurationSecs: 0,
  lastWinnerData: null,

  // Live polling intervals
  multiCourtPollingInterval: null,
  adminPollingInterval: null,

  // Screen Wake Lock for courtside phones
  wakeLock: null
};

// ============================================================================
// 1. INSTANT BOOTSTRAP & ZERO-LAG INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Hydrate from localStorage cache immediately (< 5ms) so UI is instant
  hydrateFromLocalCache();

  // 2. Setup UI listeners, sunlight mode & court selector immediately
  setupNavigation();
  initCourtSelector();
  if (localStorage.getItem('sunlight_mode') === 'true') {
    document.body.classList.add('sunlight-mode');
  }

  // 3. Check Auth Session
  initAuthSession();

  // 4. Initialize or restore active court scorer immediately from local storage
  await restoreOrInitCourtScorer(AppState.currentCourtId, false);
  renderAll();

  // 5. Fetch fresh server state via single-request /api/bootstrap in background
  await fetchBootstrapData();

  // 6. Request Screen Wake Lock so referee screen stays awake on court
  requestCourtWakeLock();
});

function hydrateFromLocalCache() {
  try {
    const cachedPlayers = localStorage.getItem('df_cache_players');
    if (cachedPlayers) AppState.players = JSON.parse(cachedPlayers) || [];

    const cachedMatches = localStorage.getItem('df_cache_matches');
    if (cachedMatches) AppState.matches = JSON.parse(cachedMatches) || [];

    const cachedTourneys = localStorage.getItem('df_cache_tournaments');
    if (cachedTourneys) AppState.tournaments = JSON.parse(cachedTourneys) || [];

    const cachedSettings = localStorage.getItem('df_cache_settings');
    if (cachedSettings) AppState.settings = JSON.parse(cachedSettings) || {};

    const cachedCourts = localStorage.getItem('df_cache_courts');
    if (cachedCourts) AppState.courts = JSON.parse(cachedCourts) || [];
  } catch (e) {
    console.warn('Cache hydration warning:', e);
  }
}

function saveToLocalCache() {
  try {
    localStorage.setItem('df_cache_players', JSON.stringify(AppState.players || []));
    localStorage.setItem('df_cache_matches', JSON.stringify(AppState.matches || []));
    localStorage.setItem('df_cache_tournaments', JSON.stringify(AppState.tournaments || []));
    localStorage.setItem('df_cache_settings', JSON.stringify(AppState.settings || {}));
    localStorage.setItem('df_cache_courts', JSON.stringify(AppState.courts || []));
  } catch (e) {}
}

async function fetchBootstrapData() {
  setSyncIndicator('syncing');
  const data = await apiGet('/api/bootstrap');
  if (data && !data.error) {
    AppState.systemInfo = data.info || {};
    AppState.settings = data.settings || {};
    AppState.players = data.players || [];
    AppState.tournaments = data.tournaments || [];
    AppState.matches = data.matches || [];
    AppState.courts = data.courts || [];
    AppState.users = data.users || [];
    saveToLocalCache();
  } else {
    // Fallback parallel load if running against older backend
    await Promise.all([
      loadSystemInfo(),
      loadSettings(),
      loadPlayers(),
      loadTournaments(),
      loadMatches(),
      loadCourts()
    ]);
    saveToLocalCache();
  }

  if (AppState.settings.voice_lang) {
    window.soundEngine.setVoiceLang(AppState.settings.voice_lang);
  }
  if (AppState.settings.sound_enabled !== undefined) {
    window.soundEngine.setSoundEnabled(AppState.settings.sound_enabled);
  }
  updateSoundIcon();
  populateCourtDropdowns();
  populateLoginPlayerPicker();
  initGoogleIdentityClient();

  // Check if server has a newer match for this court when local wasn't active
  const localMatchJson = localStorage.getItem(`padel_court_match_${AppState.currentCourtId}`);
  if (!localMatchJson && AppState.courts.length > 0) {
    const serverCourt = AppState.courts.find(c => c.id === AppState.currentCourtId);
    if (serverCourt && serverCourt.active_match && serverCourt.active_match.team_a_name) {
      AppState.scorer = MatchScorer.fromJSON(serverCourt.active_match);
      AppState.scorer.court_id = AppState.currentCourtId;
      updateScoreboardUI(true);
    }
  }

  setSyncIndicator('online');
  if (AppState.currentTab === 'admin') renderAdminDashboard();
}

function setSyncIndicator(state) {
  const dot = document.getElementById('sync-status-dot');
  if (!dot) return;
  if (state === 'syncing') {
    dot.className = 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-950 text-amber-400 border border-amber-500/30';
    dot.textContent = '↻ SYNC';
  } else if (state === 'offline') {
    dot.className = 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700';
    dot.textContent = '⚡ LOKAL';
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
function initAuthSession() {
  const savedAuth = localStorage.getItem('df_scoring_auth_user');
  renderSavedGoogleAccounts();
  populateLoginPlayerPicker();

  if (savedAuth) {
    try {
      const user = JSON.parse(savedAuth);
      if (user && user.name && user.role) {
        AppState.currentUser = user;
        applyLoggedInUserUI();
        document.getElementById('auth-gate-modal').classList.add('hidden');
        return;
      }
    } catch (e) {}
  }

  // Show Login Gate if not authenticated
  document.getElementById('auth-gate-modal').classList.remove('hidden');
  selectLoginRole('member');
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
    `<option value="${p.id}" data-name="${p.name}">${p.name} (${p.level || 'Member'})</option>`
  ).join('');
  sel.innerHTML = `<option value="">-- Pilih dari Daftar Pemain (Opsional) --</option>` + opts;
}

function handleMemberSelectRosterPlayer(playerId) {
  if (!playerId) return;
  const p = (AppState.players || []).find(x => x.id === playerId);
  if (!p) return;
  const nameInput = document.getElementById('member-google-name');
  const emailInput = document.getElementById('member-google-email');
  if (nameInput && !nameInput.value.trim()) {
    nameInput.value = p.name;
  }
  if (emailInput && !emailInput.value.trim()) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]/g, '.');
    emailInput.value = `${slug}@gmail.com`;
  }
}

function getSavedGoogleAccounts() {
  try {
    return JSON.parse(localStorage.getItem('df_saved_google_accounts') || '[]');
  } catch (e) {
    return [];
  }
}

function saveGoogleAccountToDevice(account) {
  try {
    let list = getSavedGoogleAccounts();
    list = list.filter(a => a.email.toLowerCase() !== account.email.toLowerCase());
    list.unshift({
      name: account.name,
      email: account.email,
      picture: account.picture,
      player_id: account.player_id || null
    });
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem('df_saved_google_accounts', JSON.stringify(list));
  } catch (e) {}
}

function renderSavedGoogleAccounts() {
  const wrap = document.getElementById('saved-google-accounts-wrap');
  const listEl = document.getElementById('saved-google-accounts-list');
  if (!wrap || !listEl) return;

  const accounts = getSavedGoogleAccounts();
  if (accounts.length === 0) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');
  listEl.innerHTML = accounts.map((acc, idx) => `
    <button type="button" onclick="quickLoginWithSavedGoogle(${idx})" class="w-full p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/50 rounded-xl flex items-center justify-between transition text-left">
      <div class="flex items-center space-x-2.5 truncate">
        <img src="${acc.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(acc.name)}`}" class="w-8 h-8 rounded-full object-cover border border-emerald-500/40">
        <div class="truncate">
          <div class="text-xs font-bold text-white truncate">${acc.name}</div>
          <div class="text-[10px] text-slate-400 truncate">${acc.email}</div>
        </div>
      </div>
      <span class="text-[10px] font-bold text-emerald-400 px-2 py-0.5 bg-emerald-950 rounded-lg">Masuk →</span>
    </button>
  `).join('');
}

async function quickLoginWithSavedGoogle(index) {
  const accounts = getSavedGoogleAccounts();
  const acc = accounts[index];
  if (!acc) return;
  const courtId = document.getElementById('member-login-court')?.value || AppState.currentCourtId;
  await completeUserLogin({
    name: acc.name,
    email: acc.email,
    picture: acc.picture,
    role: 'member',
    provider: 'google',
    player_id: acc.player_id || null,
    court_id: courtId
  });
}

function initGoogleIdentityClient() {
  const clientId = AppState.settings?.google_client_id;
  const gsiWrap = document.getElementById('google-gsi-button-wrap');
  if (!clientId || !window.google || !window.google.accounts || !gsiWrap) return;

  try {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredentialResponse
    });
    gsiWrap.classList.remove('hidden');
    window.google.accounts.id.renderButton(gsiWrap, {
      theme: 'filled_black',
      size: 'large',
      width: 320,
      text: 'continue_with'
    });
  } catch (e) {
    console.warn('GSI init warning:', e);
  }
}

function decodeJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

async function handleGoogleCredentialResponse(response) {
  const payload = decodeJwtPayload(response.credential);
  if (!payload) return;
  const courtId = document.getElementById('member-login-court')?.value || AppState.currentCourtId;
  await completeUserLogin({
    name: payload.name || 'Google Member',
    email: payload.email || 'member@gmail.com',
    picture: payload.picture || '',
    role: 'member',
    provider: 'google_oauth',
    court_id: courtId
  });
}

async function handleMemberGoogleLogin(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('member-google-name').value.trim();
  const email = document.getElementById('member-google-email').value.trim().toLowerCase();
  const courtId = document.getElementById('member-login-court').value || 'court_1';
  const playerId = document.getElementById('member-login-player-link').value || null;

  if (!name || !email) {
    alert('Masukkan Nama dan Email Google Anda terlebih dahulu!');
    return;
  }

  const linkedPlayer = playerId ? (AppState.players || []).find(p => p.id === playerId) : null;
  const picture = (linkedPlayer && linkedPlayer.photo_url) || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;

  saveGoogleAccountToDevice({ name, email, picture, player_id: playerId });

  await completeUserLogin({
    name,
    email,
    picture,
    role: 'member',
    provider: 'google',
    player_id: playerId,
    court_id: courtId
  });
}

async function handleAdminLogin(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('admin-login-name').value.trim() || 'Super Admin DF';
  const pwd = document.getElementById('admin-login-password').value.trim();
  const errEl = document.getElementById('admin-login-error');

  if (!ADMIN_PASSWORDS.includes(pwd)) {
    if (errEl) {
      errEl.textContent = '❌ Password Admin salah! Silakan periksa kembali password Anda.';
      errEl.classList.remove('hidden');
    }
    window.soundEngine?.playUndoBeep();
    return;
  }

  if (errEl) errEl.classList.add('hidden');

  await completeUserLogin({
    name,
    email: 'admin@dfscoring.pro',
    picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
    role: 'admin',
    password: pwd,
    provider: 'admin_password',
    court_id: AppState.currentCourtId
  });
}

async function completeUserLogin(loginPayload) {
  const userObj = {
    id: 'u_' + Math.random().toString(36).substring(2, 9),
    name: loginPayload.name,
    email: loginPayload.email,
    picture: loginPayload.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(loginPayload.name)}`,
    role: loginPayload.role,
    provider: loginPayload.provider || 'google',
    player_id: loginPayload.player_id || null,
    court_id: loginPayload.court_id || AppState.currentCourtId,
    last_login: new Date().toISOString().replace('T', ' ').substring(0, 19)
  };

  AppState.currentUser = userObj;
  localStorage.setItem('df_scoring_auth_user', JSON.stringify(userObj));

  // Switch court if member chose a specific court on login
  if (loginPayload.court_id && loginPayload.court_id !== AppState.currentCourtId) {
    await handleCourtSwitch(loginPayload.court_id);
  }

  // Stamp current scorer with logged-in user
  if (AppState.scorer) {
    AppState.scorer.scored_by = {
      name: userObj.name,
      email: userObj.email,
      role: userObj.role
    };
  }

  applyLoggedInUserUI();
  document.getElementById('auth-gate-modal').classList.add('hidden');

  // Sync login to backend in background
  apiPost('/api/auth/login', loginPayload).then(res => {
    if (res && res.user) {
      AppState.currentUser = res.user;
      localStorage.setItem('df_scoring_auth_user', JSON.stringify(res.user));
      loadUsers();
    }
  });

  if (userObj.role === 'admin') {
    showToast(`🛡️ Selamat datang, ${userObj.name}! Membuka Admin Command Center...`);
    switchTab('admin');
  } else {
    showToast(`🎾 Selamat datang, ${userObj.name}! Siap mencatat skor di ${getCourtDisplayName(AppState.currentCourtId)}.`);
    updateScoreboardUI(true);
  }
}

function applyLoggedInUserUI() {
  const u = AppState.currentUser;
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

  document.getElementById('modal-user-account').classList.remove('hidden');
}

async function handleQuickUpgradeToAdmin() {
  const pwd = document.getElementById('quick-admin-pwd-input')?.value.trim() || '';
  if (!ADMIN_PASSWORDS.includes(pwd)) {
    alert('Password Admin salah!');
    return;
  }
  document.getElementById('modal-user-account').classList.add('hidden');
  await completeUserLogin({
    name: AppState.currentUser?.name || 'Admin Utama',
    email: AppState.currentUser?.email || 'admin@dfscoring.pro',
    picture: AppState.currentUser?.picture || '',
    role: 'admin',
    password: pwd,
    provider: 'admin_password',
    court_id: AppState.currentCourtId
  });
}

function handleLogout() {
  localStorage.removeItem('df_scoring_auth_user');
  AppState.currentUser = null;
  document.getElementById('modal-user-account').classList.add('hidden');
  renderSavedGoogleAccounts();
  populateLoginPlayerPicker();
  const pwdInput = document.getElementById('admin-login-password');
  if (pwdInput) pwdInput.value = '';
  document.getElementById('auth-gate-modal').classList.remove('hidden');
  showToast('Anda telah keluar dari sesi.');
}

// ============================================================================
// 3. API HELPERS
// ============================================================================
async function apiGet(endpoint) {
  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('API GET Warning:', endpoint, e);
    return null;
  }
}

async function apiPost(endpoint, body, signal = null) {
  try {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (signal) opts.signal = signal;
    const res = await fetch(endpoint, opts);
    return await res.json();
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('API POST Warning:', endpoint, e);
    }
    return null;
  }
}

async function apiPut(endpoint, body) {
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.warn('API PUT Warning:', endpoint, e);
    return null;
  }
}

async function loadSystemInfo() {
  AppState.systemInfo = (await apiGet('/api/info')) || {};
}

async function loadSettings() {
  AppState.settings = (await apiGet('/api/settings')) || {};
}

async function loadPlayers() {
  AppState.players = (await apiGet('/api/players')) || [];
  saveToLocalCache();
}

async function loadTournaments() {
  AppState.tournaments = (await apiGet('/api/tournaments')) || [];
  saveToLocalCache();
}

async function loadMatches() {
  AppState.matches = (await apiGet('/api/matches')) || [];
  saveToLocalCache();
}

async function loadCourts() {
  AppState.courts = (await apiGet('/api/courts')) || [];
  saveToLocalCache();
}

async function loadUsers() {
  AppState.users = (await apiGet('/api/users')) || [];
}

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
      AppState.settings.sound_enabled = !current;
      apiPost('/api/settings', { sound_enabled: !current });
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
  // Gate Admin tab behind Admin role
  if (tab === 'admin' && (!AppState.currentUser || AppState.currentUser.role !== 'admin')) {
    const pwd = prompt('🛡️ Halaman ini khusus Admin Utama.\nMasukkan Password Admin:');
    if (!pwd) return;
    if (!ADMIN_PASSWORDS.includes(pwd.trim())) {
      alert('❌ Password Admin salah!');
      return;
    }
    completeUserLogin({
      name: AppState.currentUser?.name || 'Admin Utama',
      email: AppState.currentUser?.email || 'admin@dfscoring.pro',
      picture: AppState.currentUser?.picture || '',
      role: 'admin',
      password: pwd.trim(),
      provider: 'admin_password',
      court_id: AppState.currentCourtId
    });
    return;
  }

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

  // Manage Admin auto-polling interval
  if (AppState.adminPollingInterval) {
    clearInterval(AppState.adminPollingInterval);
    AppState.adminPollingInterval = null;
  }

  if (tab === 'admin') {
    refreshAdminDashboard(false);
    AppState.adminPollingInterval = setInterval(() => {
      if (AppState.currentTab === 'admin') {
        refreshAdminLiveCourtsOnly();
      }
    }, 3500);
  }
  if (tab === 'tournaments') renderTournamentsList();
  if (tab === 'players') renderPlayersTab();
  if (tab === 'history') renderHistoryTab();
  if (tab === 'settings') renderSettingsTab();
}

// ============================================================================
// 5. MULTI-COURT & DEBOUNCED ZERO-LAG SYNC
// ============================================================================
function initCourtSelector() {
  populateCourtDropdowns();
  const courtSelect = document.getElementById('header-court-select');
  if (courtSelect) {
    courtSelect.value = AppState.currentCourtId;
  }
}

function populateCourtDropdowns() {
  const defaultCourts = [
    { id: 'court_1', name: 'Lapangan 1 (HP 1)' },
    { id: 'court_2', name: 'Lapangan 2 (HP 2)' },
    { id: 'court_3', name: 'Lapangan 3' }
  ];
  const merged = [...defaultCourts];
  (AppState.courts || []).forEach(c => {
    if (c && c.id && !merged.some(m => m.id === c.id)) {
      merged.push({ id: c.id, name: c.name || getCourtDisplayName(c.id) });
    }
  });

  const headerSel = document.getElementById('header-court-select');
  const newMatchSel = document.getElementById('new-match-court-select');
  const loginSel = document.getElementById('member-login-court');

  if (headerSel) {
    headerSel.innerHTML = merged.map(c =>
      `<option value="${c.id}" class="bg-slate-900 text-white">${c.name}</option>`
    ).join('');
    headerSel.value = AppState.currentCourtId;
  }
  if (newMatchSel) {
    newMatchSel.innerHTML = merged.map(c =>
      `<option value="${c.id}">🏟️ ${c.name}</option>`
    ).join('');
    newMatchSel.value = AppState.currentCourtId;
  }
  if (loginSel) {
    loginSel.innerHTML = merged.map(c =>
      `<option value="${c.id}">🏟️ ${c.name}</option>`
    ).join('');
    loginSel.value = AppState.currentCourtId;
  }
}

function getCourtDisplayName(courtId) {
  const found = (AppState.courts || []).find(c => c.id === courtId);
  if (found && found.name) return found.name;
  if (courtId === 'court_1') return 'Lapangan 1 (HP 1)';
  if (courtId === 'court_2') return 'Lapangan 2 (HP 2)';
  if (courtId === 'court_3') return 'Lapangan 3';
  return `Lapangan ${String(courtId).replace('court_', '')}`;
}

async function restoreOrInitCourtScorer(courtId, fetchFromServer = true) {
  AppState.currentCourtId = courtId;
  localStorage.setItem('padel_active_court_id', courtId);

  const badge = document.getElementById('match-active-court-badge');
  if (badge) {
    badge.textContent = `🏟️ ${getCourtDisplayName(courtId).toUpperCase()}`;
  }

  // 1. Check local storage first (0ms latency)
  const localMatchJson = localStorage.getItem(`padel_court_match_${courtId}`);
  let restored = false;

  if (localMatchJson) {
    try {
      const matchObj = JSON.parse(localMatchJson);
      if (matchObj && (matchObj.team_a_name || matchObj.team_a)) {
        AppState.scorer = MatchScorer.fromJSON(matchObj);
        AppState.scorer.court_id = courtId;
        AppState.matchDurationSecs = matchObj.duration_seconds || 0;
        restored = true;
      }
    } catch (e) {
      console.warn('Could not parse saved court match:', e);
    }
  }

  // 2. If not local and fetchFromServer is enabled, check server
  if (!restored && fetchFromServer) {
    try {
      const courts = (await apiGet('/api/courts')) || [];
      AppState.courts = courts;
      const court = courts.find(c => c.id === courtId);
      if (court && court.active_match && (court.active_match.team_a_name || court.active_match.team_a)) {
        AppState.scorer = MatchScorer.fromJSON(court.active_match);
        AppState.scorer.court_id = courtId;
        AppState.matchDurationSecs = court.active_match.duration_seconds || 0;
        restored = true;
      }
    } catch (e) {}
  }

  if (!restored) {
    initDefaultScorer(courtId);
  }

  if (AppState.currentUser && AppState.scorer && !AppState.scorer.scored_by) {
    AppState.scorer.scored_by = {
      name: AppState.currentUser.name,
      email: AppState.currentUser.email,
      role: AppState.currentUser.role
    };
  }

  AppState.modalShown = false;
  startMatchTimer();
  updateScoreboardUI(true);
  syncActiveCourt();
}

async function handleCourtSwitch(newCourtId) {
  if (newCourtId === AppState.currentCourtId) return;

  // Flush current court immediately before switching
  if (AppState.scorer) {
    const currentJson = AppState.scorer.toLightJSON();
    currentJson.duration_seconds = AppState.matchDurationSecs;
    localStorage.setItem(`padel_court_match_${AppState.currentCourtId}`, JSON.stringify(currentJson));
    apiPost(`/api/courts/${AppState.currentCourtId}`, {
      match: currentJson,
      court_name: getCourtDisplayName(AppState.currentCourtId)
    });
  }

  const headerSel = document.getElementById('header-court-select');
  if (headerSel) headerSel.value = newCourtId;

  await restoreOrInitCourtScorer(newCourtId, true);
  showToast(`🏟️ Beralih ke: ${getCourtDisplayName(newCourtId)}`);
}

// ZERO-LAG DEBOUNCED COURT SYNC:
// Saves to localStorage in <1ms, then debounces network POST by 300ms with AbortController
function syncActiveCourt(immediate = false) {
  if (!AppState.scorer) return;
  if (AppState.currentUser) {
    AppState.scorer.scored_by = {
      name: AppState.currentUser.name,
      email: AppState.currentUser.email,
      role: AppState.currentUser.role
    };
  }

  const fullMatchData = AppState.scorer.toJSON();
  fullMatchData.duration_seconds = AppState.matchDurationSecs;

  // 1. Instant synchronous localStorage save (0ms network wait)
  try {
    localStorage.setItem(`padel_court_match_${AppState.currentCourtId}`, JSON.stringify(fullMatchData));
  } catch (e) {}

  // 2. Debounced lightweight network broadcast
  if (AppState.courtSyncTimer) {
    clearTimeout(AppState.courtSyncTimer);
  }

  const doNetworkSync = async () => {
    if (!AppState.scorer) return;
    if (AppState.courtSyncAbortCtrl) {
      try {
        AppState.courtSyncAbortCtrl.abort();
      } catch (e) {}
    }
    AppState.courtSyncAbortCtrl = new AbortController();
    const lightPayload = AppState.scorer.toLightJSON();
    lightPayload.duration_seconds = AppState.matchDurationSecs;

    setSyncIndicator('syncing');
    const res = await apiPost(
      `/api/courts/${AppState.currentCourtId}`,
      {
        match: lightPayload,
        court_name: getCourtDisplayName(AppState.currentCourtId)
      },
      AppState.courtSyncAbortCtrl.signal
    );
    setSyncIndicator(res ? 'online' : 'offline');
  };

  if (immediate) {
    doNetworkSync();
  } else {
    AppState.courtSyncTimer = setTimeout(doNetworkSync, 300);
  }
}

// Multi-Court Live Monitor Modal
function openMultiCourtMonitorModal() {
  const modal = document.getElementById('modal-multi-court');
  if (!modal) return;
  modal.classList.remove('hidden');
  renderMultiCourtGrid();

  if (AppState.multiCourtPollingInterval) clearInterval(AppState.multiCourtPollingInterval);
  AppState.multiCourtPollingInterval = setInterval(renderMultiCourtGrid, 2500);
}

function closeMultiCourtMonitorModal() {
  const modal = document.getElementById('modal-multi-court');
  if (modal) modal.classList.add('hidden');
  if (AppState.multiCourtPollingInterval) {
    clearInterval(AppState.multiCourtPollingInterval);
    AppState.multiCourtPollingInterval = null;
  }
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
          <span class="font-bold uppercase text-emerald-400">${(m.sport || 'Padel').toUpperCase()} • ${isDoubles ? 'Ganda 2v2' : 'Tunggal 1v1'}</span>
          <span class="font-mono text-slate-300">${m.rules?.golden_point ? '⭐ Golden Pt' : '🎾 Deuce'} • Target ${m.rules?.games_per_set || 6}G</span>
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
              <span class="text-sm font-bold text-white truncate">${m.team_a_name || 'Tim A'}</span>
            </div>
            <div class="flex items-center space-x-3 font-mono font-bold text-sm">
              <span class="text-amber-400 font-extrabold w-4 text-center">${setsWonA}</span>
              <span class="text-white w-4 text-center">${gamesA}</span>
              <span class="text-emerald-400 bg-slate-800 px-2 py-0.5 rounded min-w-[32px] text-center">${ptA}</span>
            </div>
          </div>

          <!-- Team B -->
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2 truncate pr-2">
              <span class="text-xs font-bold ${m.server === 'team_b' ? 'text-amber-400' : 'text-slate-600'}">${m.server === 'team_b' ? '🎾' : '•'}</span>
              <span class="text-sm font-bold text-white truncate">${m.team_b_name || 'Tim B'}</span>
            </div>
            <div class="flex items-center space-x-3 font-mono font-bold text-sm">
              <span class="text-amber-400 font-extrabold w-4 text-center">${setsWonB}</span>
              <span class="text-white w-4 text-center">${gamesB}</span>
              <span class="text-emerald-400 bg-slate-800 px-2 py-0.5 rounded min-w-[32px] text-center">${ptB}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span>👤 Pencatat: <strong class="text-slate-200">${refName}</strong></span>
          <span>🕒 ${c.last_updated ? c.last_updated.substring(11, 19) : 'Baru saja'}</span>
        </div>

        ${setsStr ? `<div class="text-[11px] text-slate-400 font-mono">Riwayat Set: <span class="text-emerald-300 font-bold">${setsStr}</span></div>` : ''}
        ${m.win_reason ? `<div class="text-xs font-bold text-red-300 bg-red-950/60 p-2 rounded-xl border border-red-500/30">🏆 ${m.win_reason}</div>` : ''}
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
        <button onclick="switchToCourtAndOpenScorer('${c.id}')" class="flex-1 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 font-bold rounded-xl text-xs transition">
          🎯 ${isCurrent ? 'Buka Papan Skor' : 'Kendalikan Lapangan Ini'}
        </button>
        ${isAdminView && m ? `
          <button onclick="handleAdminClearCourt('${c.id}')" title="Kosongkan / Reset sesi lapangan ini" class="px-2.5 py-2 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 font-bold rounded-xl text-xs transition">
            🧹 Reset
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

async function renderMultiCourtGrid() {
  const container = document.getElementById('multi-court-grid');
  if (!container) return;

  const courts = (await apiGet('/api/courts')) || AppState.courts || [];
  AppState.courts = courts;
  const defaultIds = ['court_1', 'court_2', 'court_3'];
  const allIds = Array.from(new Set([...defaultIds, ...courts.map(c => c.id)]));

  const fullCourts = allIds.map(cid => {
    const existing = courts.find(c => c.id === cid);
    return existing || { id: cid, name: getCourtDisplayName(cid), active_match: null };
  });

  container.innerHTML = fullCourts.map(c => buildCourtMonitorCardHTML(c, false)).join('');
}

async function switchToCourtAndOpenScorer(courtId) {
  closeMultiCourtMonitorModal();
  await handleCourtSwitch(courtId);
  switchTab('scorer');
}

// ============================================================================
// 6. DEFAULT SCORER & HIGH-SPEED SCOREBOARD UI (DIRTY-CHECKED DOM)
// ============================================================================
function initDefaultScorer(courtId = 'court_1') {
  const p1 = AppState.players[0] || { id: 'p1', name: 'Budi Santoso', photo_url: '' };
  const p2 = AppState.players[3] || { id: 'p4', name: 'Dimas Anggara', photo_url: '' };
  const p3 = AppState.players[1] || { id: 'p2', name: 'Rizky Pratama', photo_url: '' };
  const p4 = AppState.players[2] || { id: 'p3', name: 'Aditya Wijaya', photo_url: '' };

  AppState.scorer = new MatchScorer({
    sport: 'padel',
    mode: 'doubles',
    court_id: courtId,
    scored_by: AppState.currentUser ? {
      name: AppState.currentUser.name,
      email: AppState.currentUser.email,
      role: AppState.currentUser.role
    } : null,
    team_a_name: `${p1.name.split(' ')[0]} & ${p2.name.split(' ')[0]}`,
    team_b_name: `${p3.name.split(' ')[0]} & ${p4.name.split(' ')[0]}`,
    team_a_players: [p1, p2],
    team_b_players: [p3, p4],
    team_a_photo: p1.photo_url || '',
    team_b_photo: p3.photo_url || '',
    rules: {
      sets_to_win: 2,
      games_per_set: 6,
      golden_point: false,
      tiebreak_at: 6,
      tiebreak_points: 7
    }
  });

  AppState.matchDurationSecs = 0;
  startMatchTimer();
  updateScoreboardUI(true);
}

function startMatchTimer() {
  if (AppState.matchTimerInterval) clearInterval(AppState.matchTimerInterval);
  AppState.matchTimerInterval = setInterval(() => {
    if (AppState.scorer && !AppState.scorer.is_completed) {
      AppState.matchDurationSecs++;
      AppState.scorer.duration_seconds = AppState.matchDurationSecs;
      const mins = Math.floor(AppState.matchDurationSecs / 60);
      const secs = AppState.matchDurationSecs % 60;
      const el = document.getElementById('match-timer');
      if (el) el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);
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
  if (!s) return;

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
        <span class="text-emerald-400">${set.team_a}</span><span>-</span><span class="text-amber-400">${set.team_b}</span>
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
    undoBtn.disabled = s.history.length === 0;
    undoBtn.style.opacity = s.history.length === 0 ? '0.4' : '1';
  }
  const redoBtn = document.getElementById('btn-redo-point');
  if (redoBtn) {
    redoBtn.disabled = !s.redoStack || s.redoStack.length === 0;
    redoBtn.style.opacity = (!s.redoStack || s.redoStack.length === 0) ? '0.4' : '1';
  }

  // Active server status text
  const serverTextEl = document.getElementById('server-toggle-text');
  if (serverTextEl) {
    const activePlayer = s.getActiveServerPlayer();
    serverTextEl.textContent = `Servis: ${activePlayer.name}`;
  }

  // Check if match completed
  if (s.is_completed && !AppState.modalShown) {
    showMatchCompletedModal();
  }
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
  const currentHash = `${teamObj.name}_${isDoubles}_${isServingTeam}_${activePlayerIdx}_${pNames}`;
  const hashKey = teamKey === 'a' ? 'lastHeaderHashA' : 'lastHeaderHashB';

  if (!forceRebuild && AppState[hashKey] === currentHash) {
    return;
  }
  AppState[hashKey] = currentHash;

  if (avatarsWrap) {
    if (isDoubles && teamObj.players && teamObj.players.length >= 2) {
      const p1 = teamObj.players[0];
      const p2 = teamObj.players[1];
      const img1 = resolvePlayerPhoto(p1, 'P1');
      const img2 = resolvePlayerPhoto(p2, 'P2');

      avatarsWrap.innerHTML = `
        <div class="doubles-avatar-wrap">
          <img src="${img1}" class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 ${teamKey === 'a' ? 'border-emerald-500' : 'border-amber-500'} shadow-md">
          <img src="${img2}" class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 ${teamKey === 'a' ? 'border-emerald-400' : 'border-amber-400'} shadow-md">
        </div>
      `;
    } else {
      const p = (teamObj.players && teamObj.players[0]) || { name: teamObj.name, photo_url: teamObj.photo };
      const img = resolvePlayerPhoto(p, teamObj.name);
      avatarsWrap.innerHTML = `
        <img src="${img}" class="w-12 h-12 sm:w-15 sm:h-15 rounded-2xl object-cover border-2 ${teamKey === 'a' ? 'border-emerald-500/50' : 'border-amber-500/50'} shadow-md">
      `;
    }
  }

  if (chipsWrap) {
    if (isDoubles && teamObj.players && teamObj.players.length >= 2) {
      chipsWrap.classList.remove('hidden');
      chipsWrap.innerHTML = teamObj.players.slice(0, 2).map((player, idx) => {
        const isThisServing = isServingTeam && (activePlayerIdx === idx);
        return `
          <button onclick="handleSelectDoublesServer('team_${teamKey}', ${idx})" title="Klik untuk jadikan server" class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition ${isThisServing ? 'bg-emerald-600 text-white font-bold border border-emerald-400 shadow-sm' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}">
            <span>${isThisServing ? '🎾' : '👤'}</span>
            <span class="truncate max-w-[110px]">${player.name || `Pemain ${idx + 1}`}</span>
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
function handlePoint(team) {
  if (!AppState.scorer) return;
  AppState.scorer.addPoint(team);
  updateScoreboardUI(false);
  syncActiveCourt(false);
}

function handleUndo() {
  if (!AppState.scorer) return;
  if (AppState.scorer.undo()) {
    AppState.modalShown = false;
    updateScoreboardUI(false);
    syncActiveCourt(false);
    showToast('↩ Undo poin berhasil');
  }
}

function handleRedo() {
  if (!AppState.scorer) return;
  if (AppState.scorer.redo()) {
    updateScoreboardUI(false);
    syncActiveCourt(false);
    showToast('↪ Redo poin berhasil');
  }
}

function handleResetCurrentMatch() {
  if (!AppState.scorer) return;
  if (!confirm('Reset skor pertandingan ini kembali ke 0 - 0?')) return;
  AppState.scorer.resetMatch();
  AppState.matchDurationSecs = 0;
  AppState.modalShown = false;
  updateScoreboardUI(true);
  syncActiveCourt(true);
  showToast('🔄 Skor pertandingan di-reset ke 0 - 0');
}

function handleToggleServer() {
  if (!AppState.scorer) return;
  AppState.scorer.toggleServer();
  updateScoreboardUI(false);
  syncActiveCourt(false);
  const activePlayer = AppState.scorer.getActiveServerPlayer();
  showToast(`🎾 Giliran Servis: ${activePlayer.name}`);
}

function handleSelectDoublesServer(teamKey, playerIdx) {
  if (!AppState.scorer || AppState.scorer.mode !== 'doubles') return;
  AppState.scorer.setDoublesServer(teamKey, playerIdx);
  updateScoreboardUI(false);
  syncActiveCourt(false);
  const activePlayer = AppState.scorer.getActiveServerPlayer();
  showToast(`🎾 Server ditetapkan: ${activePlayer.name}`);
}

function handleQuickDeuce() {
  if (!AppState.scorer) return;
  AppState.scorer.setDeuce();
  updateScoreboardUI(false);
  syncActiveCourt(false);
  showToast('⚡ Skor diatur ke DEUCE (40 - 40)!');
}

function handleToggleGoldenPoint() {
  if (!AppState.scorer) return;
  const isGold = AppState.scorer.toggleGoldenPoint();
  updateScoreboardUI(false);
  syncActiveCourt(false);
  showToast(isGold ? '⭐ Mode Golden Point (No-Ad) Diaktifkan' : '🎾 Mode Deuce & Advantage Standar Diaktifkan');
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
  AppState.scorer.setTargetGames(val);
  document.getElementById('quick-target-games-modal').classList.add('hidden');
  updateScoreboardUI(false);
  syncActiveCourt(false);
  showToast(`🎯 Target set diubah menjadi ${val} Game!`);
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

  AppState.scorer.winByDefault(winnerTeam, reasonType, customNote);

  document.getElementById('modal-walkover-win').classList.add('hidden');
  syncActiveCourt(true);
  updateScoreboardUI(false);
}

// Match Completion Modal & Victory Slogan
function showMatchCompletedModal() {
  AppState.modalShown = true;
  const s = AppState.scorer;
  if (!s) return;

  // If user clicked "Selesaikan Match Sekarang" before a winner was decided, determine leading team
  if (!s.winner) {
    const setsA = s.getSetsWon('team_a');
    const setsB = s.getSetsWon('team_b');
    if (setsA > setsB) s.winner = 'team_a';
    else if (setsB > setsA) s.winner = 'team_b';
    else if (s.current_set_games.team_a > s.current_set_games.team_b) s.winner = 'team_a';
    else if (s.current_set_games.team_b > s.current_set_games.team_a) s.winner = 'team_b';
    else s.winner = (s.stats?.total_points_a || 0) >= (s.stats?.total_points_b || 0) ? 'team_a' : 'team_b';

    if (s.current_set_games.team_a > 0 || s.current_set_games.team_b > 0 || s.sets_history.length === 0) {
      s.sets_history.push({
        team_a: s.current_set_games.team_a,
        team_b: s.current_set_games.team_b,
        winner: s.winner
      });
      s.current_set_games = { team_a: 0, team_b: 0 };
    }
    s.is_completed = true;
  }

  const winnerTeam = s.winner === 'team_a' ? s.team_a : s.team_b;
  const winnerName = winnerTeam.name;

  if (window.confetti) {
    window.confetti({ particleCount: 130, spread: 80, origin: { y: 0.6 } });
  }

  const modal = document.getElementById('match-finish-modal');
  if (!modal) return;

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
          <img src="${img1}" class="w-20 h-20 rounded-3xl object-cover border-4 border-amber-400 shadow-xl">
          <img src="${img2}" class="w-20 h-20 rounded-3xl object-cover border-4 border-amber-300 shadow-xl">
        </div>
      `;
    } else {
      const p = (winnerTeam.players && winnerTeam.players[0]) || { name: winnerName, photo_url: winnerTeam.photo };
      const img = resolvePlayerPhoto(p, winnerName);
      avatarsWrap.innerHTML = `
        <img src="${img}" class="w-24 h-24 rounded-3xl object-cover border-4 border-amber-400 shadow-xl">
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

  const scoreSummary = s.sets_history.map(set => `${set.team_a}-${set.team_b}`).join(' | ');
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
  const s = AppState.scorer;
  if (!s) return;

  s.is_completed = true;
  const matchData = s.toLightJSON();
  matchData.status = 'completed';
  matchData.duration_minutes = Math.max(1, Math.round(AppState.matchDurationSecs / 60));

  showToast('💾 Menyimpan hasil pertandingan...');
  const res = await apiPost('/api/matches', matchData);

  if (s.tournament_id && s.tournament_match_id) {
    const tourney = AppState.tournaments.find(t => t.id === s.tournament_id);
    if (tourney) {
      TournamentManager.recordMatchResult(tourney, s.tournament_match_id, matchData);
      await fetch(`/api/tournaments/${tourney.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tourney)
      });
      await loadTournaments();
    }
  }

  localStorage.removeItem(`padel_court_match_${AppState.currentCourtId}`);
  await fetch(`/api/courts/${AppState.currentCourtId}`, { method: 'DELETE' });

  await Promise.all([loadMatches(), loadPlayers(), loadCourts()]);

  document.getElementById('match-finish-modal').classList.add('hidden');
  AppState.modalShown = false;

  let msg = '✅ Pertandingan berhasil disimpan!';
  if (res && res.sheet_synced) {
    msg += ' Tersinkron ke Google Sheet! 📊';
  }
  showToast(msg);

  // Re-initialize fresh match on this court so it's ready for next match
  initDefaultScorer(AppState.currentCourtId);
  switchTab(AppState.currentUser?.role === 'admin' ? 'admin' : 'history');
}

// ============================================================================
// 8. NEW MATCH SETUP MODAL (SINGLES 1v1 & DOUBLES 2v2)
// ============================================================================
function startNewMatchPrompt() {
  populateCourtDropdowns();
  populateNewMatchPlayerDropdowns();
  const modeSel = document.getElementById('new-match-mode');
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
    (AppState.players || []).map(p => `<option value="${p.id}">${p.name} (${p.level || p.skill_level || 'Intermediate'})</option>`).join('');

  selectIds.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = optionsHtml;
      if (AppState.players && AppState.players.length > 0) {
        const pick = AppState.players[idx % AppState.players.length];
        if (pick) el.value = pick.id;
      }
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

  const n1 = p1 ? p1.name.split(' ')[0] : 'Pemain 1';
  const n2 = p2 ? p2.name.split(' ')[0] : 'Pemain 2';
  teamNameInput.value = `${n1} & ${n2}`;
}

function handleGameSelectChange(selectElOrVal, wrapId = 'new-match-custom-game-wrap') {
  const val = typeof selectElOrVal === 'string' ? selectElOrVal : selectElOrVal?.value;
  const wrap = document.getElementById(wrapId);
  if (wrap) wrap.classList.toggle('hidden', val !== 'custom');
}

async function startMatchFromForm(e) {
  if (e) e.preventDefault();

  const selectedCourt = document.getElementById('new-match-court-select')?.value || AppState.currentCourtId;
  if (selectedCourt && selectedCourt !== AppState.currentCourtId) {
    AppState.currentCourtId = selectedCourt;
    localStorage.setItem('padel_active_court_id', selectedCourt);
    const headerSel = document.getElementById('header-court-select');
    if (headerSel) headerSel.value = selectedCourt;
  }

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
  let teamAPhoto = '';
  let teamBPhoto = '';

  if (mode === 'singles') {
    const pAId = document.getElementById('match-player-a-single')?.value;
    const pBId = document.getElementById('match-player-b-single')?.value;
    const pA = (AppState.players || []).find(x => x.id === pAId);
    const pB = (AppState.players || []).find(x => x.id === pBId);

    teamAName = document.getElementById('new-match-name-a-single')?.value.trim() || (pA ? pA.name : 'Pemain A');
    teamBName = document.getElementById('new-match-name-b-single')?.value.trim() || (pB ? pB.name : 'Pemain B');

    teamAPlayers = [pA || { id: '', name: teamAName, photo_url: '' }];
    teamBPlayers = [pB || { id: '', name: teamBName, photo_url: '' }];
    teamAPhoto = pA ? pA.photo_url : '';
    teamBPhoto = pB ? pB.photo_url : '';
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

    teamAName = document.getElementById('new-match-team-name-a')?.value.trim() || `${pA1Obj.name.split(' ')[0]} & ${pA2Obj.name.split(' ')[0]}`;
    teamBName = document.getElementById('new-match-team-name-b')?.value.trim() || `${pB1Obj.name.split(' ')[0]} & ${pB2Obj.name.split(' ')[0]}`;
    teamAPhoto = pA1Obj.photo_url || '';
    teamBPhoto = pB1Obj.photo_url || '';
  }

  AppState.scorer = new MatchScorer({
    sport,
    mode,
    court_id: AppState.currentCourtId,
    scored_by: AppState.currentUser ? {
      name: AppState.currentUser.name,
      email: AppState.currentUser.email,
      role: AppState.currentUser.role
    } : null,
    team_a_name: teamAName,
    team_b_name: teamBName,
    team_a_players: teamAPlayers,
    team_b_players: teamBPlayers,
    team_a_photo: teamAPhoto,
    team_b_photo: teamBPhoto,
    rules: {
      sets_to_win: setsToWin,
      games_per_set: gamesPerSet,
      golden_point: goldenPoint,
      tiebreak_at: gamesPerSet,
      tiebreak_points: 7
    }
  });

  AppState.matchDurationSecs = 0;
  AppState.modalShown = false;
  document.getElementById('new-match-modal').classList.add('hidden');

  startMatchTimer();
  updateScoreboardUI(true);
  syncActiveCourt(true);
  switchTab('scorer');
  showToast(`🎾 Pertandingan dimulai di ${getCourtDisplayName(AppState.currentCourtId)}!`);
}

// ============================================================================
// 9. ADMIN COMMAND CENTER (SUPERVISION, ANALYTICS, FULL AUDIT & REMOTE CONTROL)
// ============================================================================
async function refreshAdminDashboard(showNotification = false) {
  if (showNotification) showToast('🔄 Memperbarui data Admin Command Center...');
  const boot = await apiGet('/api/bootstrap');
  if (boot) {
    if (Array.isArray(boot.players)) AppState.players = boot.players;
    if (Array.isArray(boot.tournaments)) AppState.tournaments = boot.tournaments;
    if (Array.isArray(boot.matches)) AppState.matches = boot.matches;
    if (Array.isArray(boot.courts)) AppState.courts = boot.courts;
    if (Array.isArray(boot.users)) AppState.users = boot.users;
    if (boot.settings) AppState.settings = boot.settings;
    saveToLocalCache();
  }
  renderAdminDashboard();
  if (showNotification) showToast('✅ Data Admin diperbarui!');
}

async function refreshAdminLiveCourtsOnly() {
  const courts = await apiGet('/api/courts');
  if (Array.isArray(courts)) {
    AppState.courts = courts;
    renderAdminKpiCards();
    renderAdminLiveCourts();
  }
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

  const matches = AppState.matches || [];
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
  const container = document.getElementById('admin-live-courts-grid');
  if (!container) return;

  const courts = AppState.courts || [];
  const defaultIds = ['court_1', 'court_2', 'court_3'];
  const allIds = Array.from(new Set([...defaultIds, ...courts.map(c => c.id)]));

  const fullCourts = allIds.map(cid => {
    const existing = courts.find(c => c.id === cid);
    return existing || { id: cid, name: getCourtDisplayName(cid), active_match: null };
  });

  container.innerHTML = fullCourts.map(c => buildCourtMonitorCardHTML(c, true)).join('');
}

async function handleAdminAddCourt() {
  const nextNum = Math.max(3, (AppState.courts || []).length) + 1;
  const customName = prompt('Masukkan nama lapangan baru:', `Lapangan ${nextNum}`);
  if (!customName) return;

  const courtId = `court_${Date.now().toString().slice(-4)}`;
  await apiPost(`/api/courts/${courtId}`, {
    court_name: customName.trim(),
    match: null
  });

  await loadCourts();
  populateCourtDropdowns();
  renderAdminLiveCourts();
  renderAdminKpiCards();
  showToast(`🏟️ ${customName} berhasil ditambahkan!`);
}

async function handleAdminClearCourt(courtId) {
  if (!confirm(`Reset / Kosongkan sesi pertandingan di ${getCourtDisplayName(courtId)}?`)) return;
  await fetch(`/api/courts/${courtId}`, { method: 'DELETE' });
  localStorage.removeItem(`padel_court_match_${courtId}`);
  if (AppState.currentCourtId === courtId) {
    initDefaultScorer(courtId);
  }
  await loadCourts();
  renderAdminLiveCourts();
  renderAdminKpiCards();
  showToast(`🧹 ${getCourtDisplayName(courtId)} berhasil di-reset!`);
}

function renderAdminVisualAnalytics() {
  const matches = AppState.matches || [];
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
            <img src="${resolvePlayerPhoto(p, p.name)}" class="w-9 h-9 rounded-xl object-cover border border-slate-700">
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between text-xs font-bold mb-1">
                <span class="text-white truncate">${p.name}</span>
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
      const inTeamA = (m.team_a_players || []).some(tp => tp.id === p.id || (tp.name || '').trim().toLowerCase() === pNameLower) ||
                      (m.team_a_name || '').trim().toLowerCase() === pNameLower;
      const inTeamB = (m.team_b_players || []).some(tp => tp.id === p.id || (tp.name || '').trim().toLowerCase() === pNameLower) ||
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
        if (inTeamA) {
          gamesWon += ga;
          gamesLost += gb;
          if (ga > gb) setsWon++;
          else if (gb > ga) setsLost++;
        } else {
          gamesWon += gb;
          gamesLost += ga;
          if (gb > ga) setsWon++;
          else if (ga > gb) setsLost++;
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
      setsWon: setsWon || p.sets_won || 0,
      setsLost: setsLost || p.sets_lost || 0,
      gamesWon: gamesWon || p.games_won || 0,
      gamesLost: gamesLost || p.games_lost || 0,
      gameDiff: (gamesWon || p.games_won || 0) - (gamesLost || p.games_lost || 0),
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
            <img src="${resolvePlayerPhoto(p, p.name)}" class="w-9 h-9 rounded-xl object-cover border border-slate-700">
            <div>
              <div class="font-bold text-white">${p.name}</div>
              <div class="text-[10px] text-slate-400 truncate max-w-[150px]">${p.slogan_text ? `🔊 "${p.slogan_text}"` : 'Tanpa slogan'}</div>
            </div>
          </div>
        </td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-bold text-emerald-400">${p.level}</span>
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
          <button onclick="editPlayer('${p.id}')" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold mr-1">✏️</button>
          <button onclick="deletePlayer('${p.id}')" class="px-2.5 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-[11px] font-bold">🗑️</button>
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
    const winA = m.winner === 'team_a';
    const winB = m.winner === 'team_b';
    const isDoubles = m.mode === 'doubles';
    const courtName = getCourtDisplayName(m.court_id || 'court_1');
    const refName = m.scored_by?.name || 'Wasit';
    const totalPts = (m.stats?.total_points_a || 0) + (m.stats?.total_points_b || 0);
    const dateStr = m.created_at || m.date || '-';

    return `
      <div class="p-4 bg-slate-950/80 hover:bg-slate-950 rounded-2xl border border-slate-800 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 transition">
        <div class="space-y-1.5 flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded font-bold uppercase">${m.sport || 'PADEL'}</span>
            <span class="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 rounded font-bold uppercase">${isDoubles ? '👥 2v2' : '👤 1v1'}</span>
            <span class="px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-semibold">🏟️ ${courtName}</span>
            ${m.win_type && m.win_type !== 'normal' ? `<span class="px-2 py-0.5 bg-red-500/20 text-red-300 border border-red-500/40 rounded font-bold">${m.win_reason || 'W.O. / DQ'}</span>` : ''}
            <span class="text-slate-400">📅 ${dateStr}</span>
            <span class="text-slate-400">⏱️ ${m.duration_minutes || 1}m</span>
            <span class="text-slate-400">👤 Wasit: <strong class="text-slate-300">${refName}</strong></span>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-base sm:text-lg font-bold">
            <span class="${winA ? 'text-emerald-400' : 'text-slate-300'}">${m.team_a_name} ${winA ? '🏆' : ''}</span>
            <span class="text-slate-600 text-xs font-black">VS</span>
            <span class="${winB ? 'text-amber-400' : 'text-slate-300'}">${m.team_b_name} ${winB ? '🏆' : ''}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 self-end lg:self-center">
          <div class="text-right">
            <div class="px-3.5 py-1.5 bg-slate-900 rounded-xl border border-slate-700 font-mono font-black text-base text-white">
              ${setsStr || '0-0'}
            </div>
            ${totalPts > 0 ? `<div class="text-[10px] text-slate-400 font-mono mt-0.5">Total Poin: ${m.stats.total_points_a}-${m.stats.total_points_b}</div>` : ''}
          </div>

          <div class="flex items-center space-x-1.5">
            <button onclick="openMatchDetailModal('${m.id}')" class="px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-xl text-xs font-bold transition">
              🔍 Detail / Edit
            </button>
            <button onclick="deleteMatchHistory('${m.id}')" class="px-2.5 py-2 bg-red-600/15 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/30 rounded-xl text-xs font-bold transition" title="Hapus Match">
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
        <img src="${u.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.name || 'User')}`}" class="w-10 h-10 rounded-xl object-cover border border-slate-700">
        <div class="flex-1 min-w-0">
          <div class="flex items-center space-x-1.5">
            <span class="text-xs font-bold text-white truncate">${u.name || 'User'}</span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${isAdmin ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-emerald-500/20 text-emerald-300'}">${isAdmin ? '🛡️ ADMIN' : '🎾 MEMBER'}</span>
          </div>
          <div class="text-[10px] text-slate-400 truncate">${u.email || '-'}</div>
          <div class="text-[9px] text-slate-500 mt-0.5">Login: ${u.last_login || '-'} (${u.login_count || 1}x)</div>
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
    saveToLocalCache();
    renderAdminDashboard();
    renderPlayersTab();
    showToast('✅ Statistik seluruh pemain berhasil disinkronkan!');
  } else {
    renderAdminDashboard();
    showToast('✅ Statistik pemain diperbarui!');
  }
}

async function handleAdminBackupJSON() {
  showToast('💾 Mengunduh backup database JSON...');
  const backup = (await apiGet('/api/admin/backup')) || {
    exported_at: new Date().toISOString(),
    players: AppState.players,
    matches: AppState.matches,
    tournaments: AppState.tournaments,
    courts: AppState.courts,
    users: AppState.users
  };

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
    if (res && (res.status === 'ok' || res.status === 'restored')) {
      await refreshAdminDashboard(false);
      renderAll();
      showToast('✅ Restore database JSON berhasil!');
    } else {
      showToast('⚠️ Gagal melakukan restore database.');
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
        <span>🏟️ <strong>${getCourtDisplayName(m.court_id || 'court_1')}</strong> • ${(m.sport || 'Padel').toUpperCase()} (${m.mode === 'doubles' ? 'Ganda 2v2' : 'Tunggal 1v1'})</span>
        <span>📅 ${dateStr} • ⏱️ ${m.duration_minutes || 1} Menit</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center text-center py-2">
        <div class="p-3 rounded-xl ${m.winner === 'team_a' ? 'bg-emerald-950/50 border border-emerald-500/40' : 'bg-slate-900 border border-slate-800'}">
          <div class="text-xs text-slate-400 font-bold">TIM A ${m.winner === 'team_a' ? '🏆 WINNER' : ''}</div>
          <div class="text-base font-black text-white mt-0.5">${m.team_a_name}</div>
        </div>
        <div class="font-mono font-black text-xl text-amber-400">
          ${(m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(' | ') || '0-0'}
        </div>
        <div class="p-3 rounded-xl ${m.winner === 'team_b' ? 'bg-amber-950/50 border border-amber-500/40' : 'bg-slate-900 border border-slate-800'}">
          <div class="text-xs text-slate-400 font-bold">TIM B ${m.winner === 'team_b' ? '🏆 WINNER' : ''}</div>
          <div class="text-base font-black text-white mt-0.5">${m.team_b_name}</div>
        </div>
      </div>

      <div class="text-xs text-center text-slate-400 font-mono">${setsStr || 'Tidak ada rincian set'}</div>
      ${m.win_reason ? `<div class="text-xs text-center font-bold text-red-300 bg-red-950/50 py-1.5 px-3 rounded-xl border border-red-500/30">${m.win_reason}</div>` : ''}
    </div>

    <!-- Detailed Match Telemetry -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Total Poin</div>
        <div class="text-sm font-mono font-bold text-white mt-0.5">${st.total_points_a || 0} - ${st.total_points_b || 0}</div>
      </div>
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Deuce / Golden</div>
        <div class="text-sm font-mono font-bold text-amber-400 mt-0.5">${st.deuces_count || 0} / ${st.golden_points_count || 0}</div>
      </div>
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Streak Maks</div>
        <div class="text-sm font-mono font-bold text-emerald-400 mt-0.5">${st.max_streak_a || 0} - ${st.max_streak_b || 0}</div>
      </div>
      <div class="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
        <div class="text-[10px] text-slate-400 font-bold uppercase">Wasit Pencatat</div>
        <div class="text-xs font-bold text-sky-400 mt-0.5 truncate">${m.scored_by?.name || 'Wasit'}</div>
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
            <input type="text" id="admin-corr-team-a" value="${(m.team_a_name || '').replace(/"/g, '&quot;')}" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-1">Nama Tim B</label>
            <input type="text" id="admin-corr-team-b" value="${(m.team_b_name || '').replace(/"/g, '&quot;')}" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white">
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-1">Skor Set (pisahkan koma, misal: 6-4, 6-2)</label>
            <input type="text" id="admin-corr-sets" value="${setsInputDefault}" class="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white">
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
          <button onclick="handleAdminSaveMatchCorrection('${m.id}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs shadow-lg transition">
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
    showToast('⚠️ Gagal menyimpan koreksi pertandingan.');
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
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">${t.sport || 'Padel'}</span>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">${modeBadge}</span>
            </div>
            <span class="text-xs text-slate-400 font-semibold">${t.format === 'knockout' ? '🏆 Sistem Gugur' : '🔄 Klasemen Grup'}</span>
          </div>
          <h4 class="text-lg font-extrabold text-white mb-1">${t.name}</h4>
          <p class="text-xs text-slate-400 mb-4">${(t.participants || []).length} Peserta • Target ${t.rules?.games_per_set || 6} Game • ${t.rules?.golden_point ? 'Golden Point ⭐' : 'Deuce Normal'}</p>
        </div>
        <div class="flex space-x-2">
          <button onclick="viewTournamentBracket('${t.id}')" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition">
            Lihat Bagan / Jadwal
          </button>
          <button onclick="deleteTournament('${t.id}')" class="px-3 py-2.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-xl text-xs font-bold transition">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openCreateTournamentModal() {
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
        <input type="checkbox" name="tourney-single-participant" value="${p.id}" onchange="updateSinglesSelectedCountBadge()" ${idx < 4 ? 'checked' : ''} class="rounded text-emerald-500 focus:ring-0 w-4 h-4">
        <img src="${resolvePlayerPhoto(p, p.name)}" class="w-7 h-7 rounded-lg object-cover">
        <div class="truncate">
          <div class="text-xs font-bold text-white truncate">${p.name}</div>
          <div class="text-[10px] text-slate-400">${p.level || p.skill_level || 'Intermediate'}</div>
        </div>
      </label>
    `).join('');
    updateSinglesSelectedCountBadge();
  }

  const p1Sel = document.getElementById('tourney-pair-p1');
  const p2Sel = document.getElementById('tourney-pair-p2');
  const opts = '<option value="">-- Pilih Pemain --</option>' +
    (AppState.players || []).map(p => `<option value="${p.id}">${p.name} (${p.level || p.skill_level || 'Intermediate'})</option>`).join('');

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
            <img src="${img1}" class="w-8 h-8 rounded-full object-cover border border-amber-400">
            <img src="${img2}" class="w-8 h-8 rounded-full object-cover border border-emerald-400">
          </div>
          <div>
            <div class="text-xs font-extrabold text-white">${t.name}</div>
            <div class="text-[10px] text-slate-400">${p1.name} + ${p2.name}</div>
          </div>
        </div>
        <button type="button" onclick="removeDoublesTeam('${t.id}')" class="text-xs text-red-400 hover:text-red-300 font-bold px-2 py-1">✕ Hapus</button>
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

  let bracket = null;
  let schedule = [];
  let standings = [];

  if (format === 'knockout') {
    bracket = TournamentManager.createKnockoutBracket(selectedParticipants);
  } else {
    const rr = TournamentManager.createRoundRobin(selectedParticipants);
    schedule = rr.schedule;
    standings = rr.standings;
  }

  const payload = {
    name,
    sport,
    mode,
    format,
    participants: selectedParticipants,
    bracket,
    schedule,
    standings,
    rules: {
      sets_to_win: setsToWin,
      games_per_set: gamesPerSet,
      golden_point: goldenPoint
    }
  };

  const res = await apiPost('/api/tournaments', payload);
  await loadTournaments();
  document.getElementById('create-tournament-modal').classList.add('hidden');
  renderTournamentsList();
  if (res && res.tournament) {
    viewTournamentBracket(res.tournament.id);
  }
  showToast('🏆 Turnamen berhasil dibuat!');
}

function viewTournamentBracket(tourneyId) {
  const tourney = (AppState.tournaments || []).find(t => t.id === tourneyId);
  if (!tourney) return;
  AppState.selectedTournament = tourney;

  const modal = document.getElementById('bracket-modal');
  const titleEl = document.getElementById('bracket-tourn-title');
  const subEl = document.getElementById('bracket-tourn-subtitle');
  if (titleEl) titleEl.textContent = tourney.name;
  if (subEl) {
    subEl.textContent = `${(tourney.sport || 'Padel').toUpperCase()} • ${tourney.mode === 'doubles' ? 'Ganda 2v2' : 'Tunggal 1v1'} • ${tourney.format === 'knockout' ? 'Sistem Gugur' : 'Round Robin'}`;
  }

  if (modal) modal.classList.remove('hidden');
  renderBracketContent(tourney);
}

function renderBracketContent(tourney) {
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
  if (!tourney.bracket || !tourney.bracket.rounds) return '';
  return tourney.bracket.rounds.map(round => `
    <div class="min-w-[295px] space-y-4">
      <h4 class="text-xs font-extrabold uppercase tracking-wider text-amber-400 bg-slate-800/90 px-3 py-2 rounded-xl text-center border border-slate-700">${round.name}</h4>
      <div class="space-y-4 flex flex-col justify-around">
        ${round.matches.map(m => {
          const pA = m.player_a;
          const pB = m.player_b;
          const isReady = pA && pB && !pA.is_bye && !pB.is_bye && m.status !== 'completed';
          const winA = m.winner && pA && m.winner.id === pA.id;
          const winB = m.winner && pB && m.winner.id === pB.id;

          return `
            <div class="p-3.5 bg-slate-950 rounded-2xl border ${m.status === 'completed' ? 'border-emerald-500/40' : 'border-slate-800'} space-y-2 shadow-lg">
              <div class="flex items-center justify-between text-[10px] text-slate-500 font-bold">
                <span>MATCH #${m.match_number}</span>
                <div class="flex items-center space-x-1">
                  ${m.win_reason ? `<span class="text-red-400 font-extrabold">(${m.win_reason})</span>` : ''}
                  <span class="${m.status === 'completed' ? 'text-emerald-400' : 'text-amber-400'}">${m.status.toUpperCase()}</span>
                </div>
              </div>

              <!-- Participant A -->
              <div class="flex items-center justify-between p-2 rounded-xl ${winA ? 'bg-emerald-950/60 border border-emerald-500/40 font-bold text-emerald-300' : 'bg-slate-900/70 text-slate-300'}">
                <div class="flex items-center space-x-2 truncate">
                  ${renderParticipantAvatar(pA)}
                  <div class="truncate">
                    <div class="text-xs font-bold truncate">${pA ? pA.name : 'Menunggu...'}</div>
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
                    <div class="text-xs font-bold truncate">${pB ? pB.name : 'Menunggu...'}</div>
                    ${renderParticipantSubtext(pB)}
                  </div>
                </div>
                ${winB ? '<span>🏆</span>' : ''}
              </div>

              ${m.score_summary ? `<div class="text-center text-xs font-mono text-amber-400 bg-slate-900 py-1 rounded-lg">${m.score_summary}</div>` : ''}

              ${isReady ? `
                <div class="grid grid-cols-3 gap-1.5 mt-1">
                  <button onclick="startTournamentMatch('${tourney.id}', '${m.id}')" class="col-span-2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow">
                    ▶ Mainkan Skor
                  </button>
                  <button onclick="openBracketWalkoverPrompt('${tourney.id}', '${m.id}')" class="py-2 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 font-bold rounded-xl text-[11px] transition" title="Menang W.O. / Diskualifikasi">
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
        <img src="${img1}" class="w-6 h-6 rounded-full object-cover border border-emerald-400">
        <img src="${img2}" class="w-6 h-6 rounded-full object-cover border border-amber-400">
      </div>
    `;
  }
  const img = resolvePlayerPhoto(p, p.name);
  return `<img src="${img}" class="w-6 h-6 rounded-full object-cover flex-shrink-0">`;
}

function renderParticipantSubtext(p) {
  if (!p || p.is_bye) return '';
  if (p.mode === 'doubles' && p.players && p.players.length >= 2) {
    return `<div class="text-[9px] text-slate-400 truncate">${p.players[0].name} & ${p.players[1].name}</div>`;
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
            ${(tourney.standings || []).map((row, i) => `
              <tr class="hover:bg-slate-800/40">
                <td class="py-2.5 px-3 font-bold text-slate-400">${i + 1}</td>
                <td class="py-2.5 px-3 font-bold text-white">${row.player_name}</td>
                <td class="py-2.5 px-3 text-center">${row.played}</td>
                <td class="py-2.5 px-3 text-center text-emerald-400 font-bold">${row.wins}</td>
                <td class="py-2.5 px-3 text-center text-red-400">${row.losses}</td>
                <td class="py-2.5 px-3 text-center font-mono">${row.games_won - row.games_lost}</td>
                <td class="py-2.5 px-3 text-center font-extrabold text-amber-400">${row.points}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Jadwal Pertandingan -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        ${(tourney.schedule || []).map(m => `
          <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-2">
            <div class="text-xs font-bold text-slate-400 flex justify-between">
              <span>Match #${m.match_number}</span>
              <span class="${m.status === 'completed' ? 'text-emerald-400' : 'text-amber-400'}">${m.status}</span>
            </div>
            <div class="text-sm font-bold text-white flex items-center justify-between">
              <span class="truncate max-w-[42%]">${m.player_a.name}</span>
              <span class="text-xs text-slate-500">VS</span>
              <span class="truncate max-w-[42%] text-right">${m.player_b.name}</span>
            </div>
            ${m.score_summary ? `<div class="text-xs font-mono text-center text-emerald-400 bg-slate-900 py-1 rounded">${m.score_summary} ${m.win_reason ? `(${m.win_reason})` : ''}</div>` : ''}
            ${m.status !== 'completed' ? `
              <div class="grid grid-cols-3 gap-1.5">
                <button onclick="startTournamentMatch('${tourney.id}', '${m.id}')" class="col-span-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition">
                  ▶ Mainkan
                </button>
                <button onclick="openBracketWalkoverPrompt('${tourney.id}', '${m.id}')" class="py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 font-bold rounded-xl text-[11px] transition">
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

function startTournamentMatch(tourneyId, matchId) {
  const tourney = (AppState.tournaments || []).find(t => t.id === tourneyId);
  if (!tourney) return;

  let targetMatch = null;
  if (tourney.format === 'knockout') {
    for (const r of tourney.bracket.rounds) {
      const found = r.matches.find(m => m.id === matchId);
      if (found) { targetMatch = found; break; }
    }
  } else {
    targetMatch = tourney.schedule.find(m => m.id === matchId);
  }

  if (!targetMatch || !targetMatch.player_a || !targetMatch.player_b) return;

  const pA = targetMatch.player_a;
  const pB = targetMatch.player_b;
  const isDoubles = tourney.mode === 'doubles' || pA.mode === 'doubles';

  AppState.scorer = new MatchScorer({
    sport: tourney.sport || 'padel',
    mode: isDoubles ? 'doubles' : 'singles',
    court_id: AppState.currentCourtId,
    scored_by: AppState.currentUser ? {
      name: AppState.currentUser.name,
      email: AppState.currentUser.email,
      role: AppState.currentUser.role
    } : null,
    tournament_id: tourney.id,
    tournament_match_id: targetMatch.id,
    team_a_name: pA.name,
    team_b_name: pB.name,
    team_a_players: pA.players || [pA],
    team_b_players: pB.players || [pB],
    team_a_photo: pA.photo_url || '',
    team_b_photo: pB.photo_url || '',
    rules: {
      sets_to_win: tourney.rules?.sets_to_win || 2,
      games_per_set: tourney.rules?.games_per_set || 6,
      golden_point: tourney.rules?.golden_point || false,
      tiebreak_at: tourney.rules?.games_per_set || 6,
      tiebreak_points: 7
    }
  });

  document.getElementById('bracket-modal')?.classList.add('hidden');
  AppState.matchDurationSecs = 0;
  AppState.modalShown = false;
  startMatchTimer();
  updateScoreboardUI(true);
  syncActiveCourt(true);
  switchTab('scorer');
  showToast(`🏆 Match Turnamen: ${pA.name} vs ${pB.name} dimulai!`);
}

async function openBracketWalkoverPrompt(tourneyId, matchId) {
  const tourney = (AppState.tournaments || []).find(t => t.id === tourneyId);
  if (!tourney) return;

  let targetMatch = null;
  if (tourney.format === 'knockout') {
    for (const r of tourney.bracket.rounds) {
      const found = r.matches.find(m => m.id === matchId);
      if (found) { targetMatch = found; break; }
    }
  } else {
    targetMatch = tourney.schedule.find(m => m.id === matchId);
  }

  if (!targetMatch || !targetMatch.player_a || !targetMatch.player_b) return;

  const choice = prompt(
    `Pilih Pemenang Walkover (W.O.) / Diskualifikasi:\n` +
    `Ketik "1" untuk memenangkan: ${targetMatch.player_a.name}\n` +
    `Ketik "2" untuk memenangkan: ${targetMatch.player_b.name}`,
    '1'
  );
  if (choice !== '1' && choice !== '2') return;

  const reason = prompt('Masukkan alasan (misal: Lawan W.O. / Diskualifikasi / Cedera):', 'Menang W.O. (Lawan Diskualifikasi)') || 'Menang W.O.';
  const winnerTeam = choice === '1' ? 'team_a' : 'team_b';

  const matchResult = {
    sport: tourney.sport || 'padel',
    mode: tourney.mode || 'singles',
    court_id: AppState.currentCourtId,
    scored_by: AppState.currentUser ? {
      name: AppState.currentUser.name,
      email: AppState.currentUser.email,
      role: AppState.currentUser.role
    } : null,
    tournament_id: tourney.id,
    tournament_match_id: targetMatch.id,
    team_a_name: targetMatch.player_a.name,
    team_b_name: targetMatch.player_b.name,
    team_a_players: targetMatch.player_a.players || [targetMatch.player_a],
    team_b_players: targetMatch.player_b.players || [targetMatch.player_b],
    winner: winnerTeam,
    winner_name: winnerTeam === 'team_a' ? targetMatch.player_a.name : targetMatch.player_b.name,
    win_type: 'walkover',
    win_reason: reason,
    sets_history: [
      { team_a: winnerTeam === 'team_a' ? 6 : 0, team_b: winnerTeam === 'team_b' ? 6 : 0, winner: winnerTeam },
      { team_a: winnerTeam === 'team_a' ? 6 : 0, team_b: winnerTeam === 'team_b' ? 6 : 0, winner: winnerTeam }
    ],
    duration_minutes: 1,
    status: 'completed'
  };

  await apiPost('/api/matches', matchResult);
  TournamentManager.recordMatchResult(tourney, targetMatch.id, matchResult);
  await apiPut(`/api/tournaments/${tourney.id}`, tourney);

  await Promise.all([loadTournaments(), loadMatches(), loadPlayers()]);
  viewTournamentBracket(tourney.id);
  showToast(`🏳️ Hasil ${reason} berhasil dicatat ke bagan!`);
}

function openSwapBracketModal() {
  const tourney = AppState.selectedTournament;
  if (!tourney || tourney.format !== 'knockout') {
    showToast('Fitur tukar slot hanya untuk turnamen Sistem Gugur (Knockout).');
    return;
  }

  const r1 = tourney.bracket.rounds[0];
  const slots = [];
  r1.matches.forEach((m, mIdx) => {
    slots.push({
      key: `${mIdx}_a`,
      label: `Match #${m.match_number} - Slot Atas: ${m.player_a ? m.player_a.name : 'BYE'}`
    });
    slots.push({
      key: `${mIdx}_b`,
      label: `Match #${m.match_number} - Slot Bawah: ${m.player_b ? m.player_b.name : 'BYE'}`
    });
  });

  const optsHtml = slots.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
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

  const r1 = tourney.bracket.rounds[0];
  const prop1 = side1 === 'a' ? 'player_a' : 'player_b';
  const prop2 = side2 === 'a' ? 'player_a' : 'player_b';

  const temp = r1.matches[parseInt(mIdx1)][prop1];
  r1.matches[parseInt(mIdx1)][prop1] = r1.matches[parseInt(mIdx2)][prop2];
  r1.matches[parseInt(mIdx2)][prop2] = temp;

  TournamentManager.recomputeRound1Byes(tourney.bracket);

  await apiPut(`/api/tournaments/${tourney.id}`, tourney);

  document.getElementById('modal-swap-bracket').classList.add('hidden');
  renderBracketContent(tourney);
  showToast('🔄 Posisi peserta di bagan berhasil ditukar!');
}

async function handleReshuffleBracket(tourneyId) {
  const tourney = tourneyId
    ? (AppState.tournaments || []).find(t => t.id === tourneyId)
    : AppState.selectedTournament;
  if (!tourney) return;

  if (!confirm('Acak ulang seluruh posisi peserta di bagan? (Progress pertandingan di turnamen ini akan di-reset)')) return;

  if (tourney.format === 'knockout') {
    tourney.bracket = TournamentManager.createKnockoutBracket(tourney.participants);
  } else {
    const shuffled = [...tourney.participants].sort(() => Math.random() - 0.5);
    const rr = TournamentManager.createRoundRobin(shuffled);
    tourney.schedule = rr.schedule;
    tourney.standings = rr.standings;
  }

  await apiPut(`/api/tournaments/${tourney.id}`, tourney);
  await loadTournaments();
  document.getElementById('modal-swap-bracket')?.classList.add('hidden');
  viewTournamentBracket(tourney.id);
  showToast('🎲 Bagan turnamen berhasil diacak ulang!');
}

async function deleteTournament(id) {
  if (!confirm('Hapus turnamen ini?')) return;
  await fetch(`/api/tournaments/${id}`, { method: 'DELETE' });
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
    const safeName = (p.name || '').replace(/'/g, "\\'");

    return `
      <div class="p-5 bg-slate-900 rounded-3xl border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition shadow-lg">
        <div class="flex items-center space-x-4">
          <img src="${avatar}" class="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/40 bg-slate-800">
          <div class="flex-1 min-w-0">
            <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-slate-800 text-emerald-400 border border-slate-700">${p.level}</span>
            <h4 class="text-lg font-extrabold text-white truncate mt-1">${p.name}</h4>
            <p class="text-xs text-slate-400">Menang: <strong class="text-emerald-400">${p.wins || 0}</strong> • Kalah: <strong class="text-red-400">${p.losses || 0}</strong> (${p.winRate}%)</p>
          </div>
        </div>

        <div class="p-3 bg-slate-950/90 rounded-2xl border border-slate-800/80 text-xs space-y-2">
          <div class="flex items-center justify-between text-slate-400 font-semibold">
            <span>🔊 Slogan Kemenangan:</span>
            ${hasVoice ? `<button onclick="window.soundEngine.playVictorySlogan(AppState.players.find(x=>x.id==='${p.id}'), '${safeName}')" class="text-emerald-400 hover:underline font-bold">▶ Putar Suara</button>` : '<span class="text-slate-600">Belum ada</span>'}
          </div>
          <p class="italic text-amber-300 font-medium">"${p.slogan_text || 'Belum mengatur teks slogan'}"</p>
        </div>

        <div class="flex space-x-2">
          <button onclick="editPlayer('${p.id}')" class="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition">✏️ Edit / Rekam Suara</button>
          <button onclick="deletePlayer('${p.id}')" class="px-3 py-2 bg-red-500/10 hover:bg-red-500/30 text-red-400 rounded-xl text-xs font-bold transition">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function openPlayerModal(player = null) {
  document.getElementById('player-form-id').value = player ? player.id : '';
  document.getElementById('player-form-name').value = player ? player.name : '';
  document.getElementById('player-form-nickname').value = player ? (player.nickname || '') : '';
  document.getElementById('player-form-hand').value = player ? (player.hand || 'Kanan') : 'Kanan';
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

      AppState.mediaRecorder.onstop = async () => {
        const blob = new Blob(AppState.audioChunks, { type: 'audio/webm' });
        await uploadRecordedAudioBlob(blob);
        stream.getTracks().forEach(t => t.stop());
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
    hand: document.getElementById('player-form-hand').value,
    level: levelVal,
    skill_level: levelVal,
    slogan_text: document.getElementById('player-form-slogan-text').value.trim(),
    photo_url: document.getElementById('player-form-photo-url').value,
    slogan_audio_url: document.getElementById('player-form-slogan-audio-url').value,
    notes: document.getElementById('player-form-notes').value.trim()
  };

  if (id) {
    await apiPut(`/api/players/${id}`, payload);
  } else {
    await apiPost('/api/players', payload);
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
  await fetch(`/api/players/${id}`, { method: 'DELETE' });
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
    const winA = m.winner === 'team_a';
    const winB = m.winner === 'team_b';
    const isDoubles = m.mode === 'doubles';
    const courtName = getCourtDisplayName(m.court_id || 'court_1');
    const dateStr = m.created_at || m.date || '';

    return `
      <div class="p-4 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-slate-700 transition">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-bold uppercase">${m.sport || 'PADEL'}</span>
            <span class="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 rounded font-bold uppercase">${isDoubles ? '👥 2v2' : '👤 1v1'}</span>
            <span class="px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-semibold">🏟️ ${courtName}</span>
            ${m.win_type && m.win_type !== 'normal' ? `<span class="px-2 py-0.5 bg-red-500/20 text-red-300 border border-red-500/40 rounded font-bold">${m.win_reason || 'W.O. / DQ'}</span>` : ''}
            <span class="text-slate-500">${dateStr}</span>
            <span class="text-slate-500">• ${m.duration_minutes || 1} Menit</span>
          </div>
          <div class="flex items-center space-x-3 text-base sm:text-lg font-bold pt-1">
            <span class="${winA ? 'text-emerald-400' : 'text-slate-300'}">${m.team_a_name} ${winA ? '🏆' : ''}</span>
            <span class="text-slate-600 text-xs">VS</span>
            <span class="${winB ? 'text-amber-400' : 'text-slate-300'}">${m.team_b_name} ${winB ? '🏆' : ''}</span>
          </div>
        </div>
        <div class="flex items-center space-x-2 self-end sm:self-center">
          <div class="px-4 py-2 bg-slate-950 rounded-xl border border-slate-800 font-mono font-extrabold text-base text-white">
            ${setsStr || '0-0'}
          </div>
          <button onclick="openMatchDetailModal('${m.id}')" class="p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition text-xs font-bold" title="Detail Match">🔍</button>
          <button onclick="deleteMatchHistory('${m.id}')" class="p-2 text-slate-500 hover:text-red-400 transition" title="Hapus">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteMatchHistory(id) {
  if (!confirm('Hapus riwayat pertandingan ini?')) return;
  await fetch(`/api/matches/${id}`, { method: 'DELETE' });
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
  await apiPost('/api/settings', payload);
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
  const res = await apiPost('/api/sheets/test', { google_sheet_url: url, webhook_url: url });
  if (res && (res.success || res.status === 'success')) {
    showToast('✅ Terhubung! Baris tes berhasil dikirim ke Google Sheet.');
  } else {
    alert('Gagal mengirim ke Google Sheet: ' + (res?.message || 'Periksa URL Webhook'));
  }
}

async function triggerBulkSheetSync() {
  showToast('⏳ Menyinkronkan semua riwayat ke Google Sheet...');
  const res = await apiPost('/api/sheets/sync-all', {});
  if (res && (res.status === 'ok' || res.status === 'success')) {
    showToast(`✅ Berhasil menyinkronkan ${res.synced_count ?? ''} pertandingan ke Google Sheet!`);
  } else {
    alert(res?.message || 'Gagal sinkronisasi. Pastikan URL Google Sheet sudah diisi di tab Pengaturan.');
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
    const [matches, players, tournaments] = await Promise.all([
      apiGet('/api/matches'),
      apiGet('/api/players'),
      apiGet('/api/tournaments')
    ]);

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
