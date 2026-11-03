/**
 * Main Application Logic for Padel & Tennis Master PRO
 * Handles live scoring, singles & doubles (4 players), Deuce & Advantage,
 * mini games (1 to 10+ games), tournament bracket pairing, custom seed swapping,
 * walkover / disqualification wins, voice slogan recording & celebration,
 * multi-court/multi-device independent scoring, and Google Sheets sync.
 */

const AppState = {
  currentTab: 'scorer',
  currentCourtId: localStorage.getItem('padel_active_court_id') || 'court_1',
  scorer: null,
  players: [],
  tournaments: [],
  matches: [],
  settings: {},
  systemInfo: {},
  selectedTournament: null,
  matchTimerInterval: null,
  matchDurationSecs: 0,
  tourneyDoublesTeams: [], // Staged doubles teams for tournament creation
  modalShown: false,

  // Voice Slogan Recording
  mediaRecorder: null,
  audioChunks: [],
  isRecordingVoice: false,
  recordTimerInterval: null,
  recordDurationSecs: 0,
  lastWinnerData: null,

  // Multi-court live monitoring
  multiCourtPollingInterval: null
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadSystemInfo();
  await loadSettings();
  await loadPlayers();
  await loadTournaments();
  await loadMatches();

  setupNavigation();
  initCourtSelector();
  await restoreOrInitCourtScorer(AppState.currentCourtId);
  renderAll();

  // Sunlight mode check
  if (localStorage.getItem('sunlight_mode') === 'true') {
    document.body.classList.add('sunlight-mode');
  }
});

// --- API Calls ---
async function apiGet(endpoint) {
  try {
    const res = await fetch(endpoint);
    return await res.json();
  } catch (e) {
    console.error("API GET Error:", e);
    return null;
  }
}

async function apiPost(endpoint, body) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error("API POST Error:", e);
    return null;
  }
}

async function loadSystemInfo() {
  AppState.systemInfo = await apiGet('/api/info') || {};
  const ipEl = document.getElementById('network-ip-banner');
  if (ipEl && AppState.systemInfo.network_url) {
    ipEl.textContent = AppState.systemInfo.network_url;
  }
}

async function loadSettings() {
  AppState.settings = await apiGet('/api/settings') || {};
  if (AppState.settings.voice_lang) {
    window.soundEngine.setVoiceLang(AppState.settings.voice_lang);
  }
  if (AppState.settings.sound_enabled !== undefined) {
    window.soundEngine.setSoundEnabled(AppState.settings.sound_enabled);
  }
  updateSoundIcon();
}

async function loadPlayers() {
  AppState.players = await apiGet('/api/players') || [];
}

async function loadTournaments() {
  AppState.tournaments = await apiGet('/api/tournaments') || [];
}

async function loadMatches() {
  AppState.matches = await apiGet('/api/matches') || [];
}

// --- Navigation ---
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Sound toggle button
  const soundBtn = document.getElementById('btn-toggle-sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const current = window.soundEngine.soundEnabled;
      window.soundEngine.setSoundEnabled(!current);
      AppState.settings.sound_enabled = !current;
      apiPost('/api/settings', { sound_enabled: !current });
      updateSoundIcon();
      showToast(window.soundEngine.soundEnabled ? 'Suara & Wasit Aktif' : 'Suara Dimatikan');
    });
  }

  // Sunlight mode toggle
  const sunBtn = document.getElementById('btn-toggle-sunlight');
  if (sunBtn) {
    sunBtn.addEventListener('click', () => {
      document.body.classList.toggle('sunlight-mode');
      const isSun = document.body.classList.contains('sunlight-mode');
      localStorage.setItem('sunlight_mode', isSun);
      showToast(isSun ? 'Mode Lapangan Terang (Outdoor)' : 'Mode Standar Gelap');
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
  AppState.currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('bg-emerald-600', 'text-white', 'shadow-lg');
      btn.classList.remove('text-slate-300', 'hover:bg-slate-800');
    } else {
      btn.classList.remove('bg-emerald-600', 'text-white', 'shadow-lg');
      btn.classList.add('text-slate-300', 'hover:bg-slate-800');
    }
  });

  if (tab === 'tournaments') renderTournamentsList();
  if (tab === 'players') renderPlayersTab();
  if (tab === 'history') renderHistoryTab();
  if (tab === 'settings') renderSettingsTab();
}

// --- Multi-Court Support (Point 5) ---
function initCourtSelector() {
  const courtSelect = document.getElementById('header-court-select');
  if (courtSelect) {
    courtSelect.value = AppState.currentCourtId;
  }
}

function getCourtDisplayName(courtId) {
  if (courtId === 'court_1') return 'Lapangan 1 (HP 1)';
  if (courtId === 'court_2') return 'Lapangan 2 (HP 2)';
  if (courtId === 'court_3') return 'Lapangan 3';
  return courtId;
}

async function restoreOrInitCourtScorer(courtId) {
  AppState.currentCourtId = courtId;
  localStorage.setItem('padel_active_court_id', courtId);

  // Check local storage first
  const localMatchJson = localStorage.getItem(`padel_court_match_${courtId}`);
  let restored = false;

  if (localMatchJson) {
    try {
      const matchObj = JSON.parse(localMatchJson);
      if (matchObj && matchObj.team_a && matchObj.team_b) {
        AppState.scorer = MatchScorer.fromJSON(matchObj);
        AppState.scorer.court_id = courtId;
        AppState.matchDurationSecs = matchObj.duration_seconds || 0;
        restored = true;
      }
    } catch (e) {
      console.warn("Could not parse saved court match:", e);
    }
  }

  // If not local, check server for this court
  if (!restored) {
    const courts = await apiGet('/api/courts') || [];
    const court = courts.find(c => c.id === courtId);
    if (court && court.active_match) {
      AppState.scorer = MatchScorer.fromJSON(court.active_match);
      AppState.scorer.court_id = courtId;
      restored = true;
    }
  }

  if (!restored) {
    initDefaultScorer(courtId);
  }

  AppState.modalShown = false;
  startMatchTimer();
  updateScoreboardUI();
  syncActiveCourt();
}

async function handleCourtSwitch(newCourtId) {
  if (newCourtId === AppState.currentCourtId) return;

  // Save current court before switching
  if (AppState.scorer) {
    const currentJson = AppState.scorer.toJSON();
    currentJson.duration_seconds = AppState.matchDurationSecs;
    localStorage.setItem(`padel_court_match_${AppState.currentCourtId}`, JSON.stringify(currentJson));
    await apiPost(`/api/courts/${AppState.currentCourtId}`, {
      match: currentJson,
      court_name: getCourtDisplayName(AppState.currentCourtId)
    });
  }

  await restoreOrInitCourtScorer(newCourtId);
  showToast(`Beralih ke: ${getCourtDisplayName(newCourtId)}`);
}

function syncActiveCourt() {
  if (!AppState.scorer) return;
  const matchData = AppState.scorer.toJSON();
  matchData.duration_seconds = AppState.matchDurationSecs;

  // 1. Local storage cache
  localStorage.setItem(`padel_court_match_${AppState.currentCourtId}`, JSON.stringify(matchData));

  // 2. Server broadcast (for multi-HP and monitor view)
  apiPost(`/api/courts/${AppState.currentCourtId}`, {
    match: matchData,
    court_name: getCourtDisplayName(AppState.currentCourtId)
  });
}

// Multi-Court Live Monitor
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

async function renderMultiCourtGrid() {
  const container = document.getElementById('multi-court-grid');
  if (!container) return;

  const courts = await apiGet('/api/courts') || [];
  const defaultList = ['court_1', 'court_2', 'court_3'];

  // Ensure all 3 courts are rendered
  const fullCourts = defaultList.map(cid => {
    const existing = courts.find(c => c.id === cid);
    return existing || { id: cid, name: getCourtDisplayName(cid), active_match: null };
  });

  container.innerHTML = fullCourts.map(c => {
    const isCurrent = c.id === AppState.currentCourtId;
    const m = c.active_match;
    const isLive = m && !m.is_completed;
    const isComplete = m && m.is_completed;

    let matchBody = '';
    if (m) {
      const isDoubles = m.mode === 'doubles';
      const setsStr = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(', ');

      matchBody = `
        <div class="space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-bold uppercase text-emerald-400">${m.sport || 'Padel'} • ${isDoubles ? 'Ganda' : 'Tunggal'}</span>
            <span class="font-mono text-slate-300">${m.rules?.golden_point ? '⭐ Golden Point' : 'Deuce (Advantage)'}</span>
          </div>

          <!-- Teams and Scores -->
          <div class="p-3 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2">
            <!-- Team A -->
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2 truncate">
                <span class="text-xs font-bold ${m.server === 'team_a' ? 'text-emerald-400' : 'text-slate-400'}">${m.server === 'team_a' ? '🎾' : '•'}</span>
                <span class="text-sm font-bold text-white truncate">${m.team_a_name || 'Tim A'}</span>
              </div>
              <div class="flex items-center space-x-3 font-mono font-bold text-sm">
                <span class="text-amber-400 font-extrabold">${m.sets_won ? m.sets_won.team_a : 0}</span>
                <span class="text-slate-300">${m.current_set_games ? m.current_set_games.team_a : 0}</span>
                <span class="text-emerald-400 bg-slate-800 px-2 py-0.5 rounded">${m.display_point_a || 0}</span>
              </div>
            </div>

            <!-- Team B -->
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2 truncate">
                <span class="text-xs font-bold ${m.server === 'team_b' ? 'text-amber-400' : 'text-slate-400'}">${m.server === 'team_b' ? '🎾' : '•'}</span>
                <span class="text-sm font-bold text-white truncate">${m.team_b_name || 'Tim B'}</span>
              </div>
              <div class="flex items-center space-x-3 font-mono font-bold text-sm">
                <span class="text-amber-400 font-extrabold">${m.sets_won ? m.sets_won.team_b : 0}</span>
                <span class="text-slate-300">${m.current_set_games ? m.current_set_games.team_b : 0}</span>
                <span class="text-emerald-400 bg-slate-800 px-2 py-0.5 rounded">${m.display_point_b || 0}</span>
              </div>
            </div>
          </div>

          ${setsStr ? `<div class="text-xs text-slate-400 font-mono">Set Sebelumnya: <span class="text-slate-200 font-bold">${setsStr}</span></div>` : ''}
          ${m.win_reason ? `<div class="text-xs font-bold text-red-400 bg-red-950/60 p-2 rounded-xl border border-red-500/30">🏆 ${m.win_reason}</div>` : ''}
        </div>
      `;
    } else {
      matchBody = `
        <div class="py-8 text-center text-slate-500">
          <span class="text-3xl block mb-2">🎾</span>
          <p class="text-xs">Tidak ada pertandingan aktif saat ini.</p>
        </div>
      `;
    }

    return `
      <div class="p-5 rounded-3xl border-2 transition ${isCurrent ? 'bg-slate-900 border-emerald-500 shadow-xl' : 'bg-slate-900/80 border-slate-800'} flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center space-x-2">
              <span class="text-lg">🏟️</span>
              <h4 class="text-base font-black text-white">${c.name || getCourtDisplayName(c.id)}</h4>
            </div>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${isLive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse' : isComplete ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800 text-slate-400'}">
              ${isLive ? '● LIVE' : isComplete ? '🏆 SELESAI' : 'STANDBY'}
            </span>
          </div>

          ${matchBody}
        </div>

        <div class="pt-4 border-t border-slate-800 mt-4 flex items-center space-x-2">
          ${isCurrent ? `
            <span class="flex-1 py-2 text-center text-xs font-bold text-emerald-400 bg-emerald-950/60 rounded-xl border border-emerald-500/40">
              ✓ Sedang Digunakan di HP Ini
            </span>
          ` : `
            <button onclick="switchToCourtAndClose('${c.id}')" class="flex-1 py-2 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 font-bold rounded-xl text-xs transition">
              Beralih ke Lapangan Ini →
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

async function switchToCourtAndClose(courtId) {
  closeMultiCourtMonitorModal();
  const sel = document.getElementById('header-court-select');
  if (sel) sel.value = courtId;
  await handleCourtSwitch(courtId);
}

// --- Default Scorer Setup ---
function initDefaultScorer(courtId = 'court_1') {
  const p1 = AppState.players[0] || { name: 'Budi Santoso', photo_url: '' };
  const p2 = AppState.players[3] || { name: 'Dimas Anggara', photo_url: '' };
  const p3 = AppState.players[1] || { name: 'Rizky Pratama', photo_url: '' };
  const p4 = AppState.players[2] || { name: 'Aditya Wijaya', photo_url: '' };

  AppState.scorer = new MatchScorer({
    sport: 'padel',
    mode: 'doubles',
    court_id: courtId,
    team_a_name: 'Budi & Dimas',
    team_b_name: 'Rizky & Aditya',
    team_a_players: [p1, p2],
    team_b_players: [p3, p4],
    team_a_photo: p1.photo_url || '',
    team_b_photo: p3.photo_url || '',
    rules: {
      sets_to_win: 2,
      games_per_set: 6,
      golden_point: false, // Default standard Deuce & Advantage
      tiebreak_at: 6,
      tiebreak_points: 7
    }
  });

  startMatchTimer();
  updateScoreboardUI();
}

function startMatchTimer() {
  if (AppState.matchTimerInterval) clearInterval(AppState.matchTimerInterval);
  AppState.matchTimerInterval = setInterval(() => {
    if (AppState.scorer && !AppState.scorer.is_completed) {
      AppState.matchDurationSecs++;
      const mins = Math.floor(AppState.matchDurationSecs / 60);
      const secs = AppState.matchDurationSecs % 60;
      const el = document.getElementById('match-timer');
      if (el) el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);
}

// --- Scoreboard UI Updates ---
function updateScoreboardUI() {
  const s = AppState.scorer;
  if (!s) return;

  const isDoubles = s.mode === 'doubles';

  // Sport & Mode Tag
  const sportTag = document.getElementById('match-sport-tag');
  if (sportTag) {
    const modeLabel = isDoubles ? 'GANDA (4 PEMAIN)' : 'TUNGGAL (1v1)';
    sportTag.textContent = `${s.sport.toUpperCase()} • ${modeLabel} • BEST OF ${s.rules.sets_to_win * 2 - 1}`;
  }

  // Target Games Indicator
  const targetLabel = document.getElementById('match-target-games-label');
  if (targetLabel) {
    targetLabel.textContent = `${s.rules.games_per_set} Game`;
  }

  // Scoring Mode Pill (Deuce vs Golden Point)
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

  // --- TEAM A UI ---
  renderTeamScoreHeader('a', s.team_a, s.server === 'team_a', isDoubles, s.server_player_index.team_a);

  // --- TEAM B UI ---
  renderTeamScoreHeader('b', s.team_b, s.server === 'team_b', isDoubles, s.server_player_index.team_b);

  // Digits Grid (Points, Games, Sets)
  const ptA = s.getDisplayPoint('team_a');
  const ptB = s.getDisplayPoint('team_b');
  document.getElementById('digit-point-a').textContent = ptA;
  document.getElementById('digit-point-b').textContent = ptB;

  // Games in current set
  document.getElementById('score-games-a').textContent = s.current_set_games.team_a;
  document.getElementById('score-games-b').textContent = s.current_set_games.team_b;

  // Sets Won
  document.getElementById('score-sets-a').textContent = s.getSetsWon('team_a');
  document.getElementById('score-sets-b').textContent = s.getSetsWon('team_b');

  // Sub-badges under point digit (Advantage highlight)
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
      goldBanner.classList.add('hidden');
    } else if (s.isGoldenPoint()) {
      goldBanner.classList.remove('hidden');
      deuceBanner.classList.add('hidden');
    } else if (s.hasAdvantage()) {
      const advTeam = s.getAdvantageTeam();
      const advName = advTeam === 'team_a' ? s.team_a.name : s.team_b.name;
      deuceBanner.classList.remove('hidden');
      deuceBanner.innerHTML = `⚡ ADVANTAGE: ${advName} - Butuh 1 Poin untuk Menang Game!`;
      goldBanner.classList.add('hidden');
    } else {
      deuceBanner.classList.add('hidden');
      goldBanner.classList.add('hidden');
    }
  }

  // Dynamic Add Point Button Texts based on state
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
      btnTextA.textContent = `+ POIN TIM A`;
      btnTextB.textContent = `+ POIN TIM B`;
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
    historyContainer.innerHTML = '';
    s.sets_history.forEach((set, idx) => {
      const pill = document.createElement('div');
      pill.className = 'px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono font-bold flex items-center space-x-1 whitespace-nowrap';
      pill.innerHTML = `<span class="text-slate-400">Set ${idx + 1}:</span> <span class="text-emerald-400">${set.team_a}</span>-<span class="text-amber-400">${set.team_b}</span>`;
      historyContainer.appendChild(pill);
    });
  }

  // Undo button state
  const undoBtn = document.getElementById('btn-undo-point');
  if (undoBtn) {
    undoBtn.disabled = s.history.length === 0;
    undoBtn.style.opacity = s.history.length === 0 ? '0.4' : '1';
  }

  // Active server status text in footer
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

// Render Team Score Header with Single or Dual Avatars & Chips
function renderTeamScoreHeader(teamKey, teamObj, isServingTeam, isDoubles, activePlayerIdx) {
  const nameEl = document.getElementById(`score-name-${teamKey}`);
  const badgeEl = document.getElementById(`score-mode-badge-${teamKey}`);
  const ballEl = document.getElementById(`server-indicator-${teamKey}`);
  const avatarsWrap = document.getElementById(`score-avatars-${teamKey}`);
  const chipsWrap = document.getElementById(`doubles-players-chips-${teamKey}`);

  if (nameEl) nameEl.textContent = teamObj.name;
  if (badgeEl) badgeEl.classList.toggle('hidden', !isDoubles);
  if (ballEl) ballEl.classList.toggle('hidden', !isServingTeam);

  // Avatar rendering
  if (avatarsWrap) {
    if (isDoubles && teamObj.players && teamObj.players.length >= 2) {
      const p1 = teamObj.players[0];
      const p2 = teamObj.players[1];
      const img1 = p1.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p1.name || 'P1')}`;
      const img2 = p2.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p2.name || 'P2')}`;

      avatarsWrap.innerHTML = `
        <div class="doubles-avatar-wrap">
          <img src="${img1}" class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 ${teamKey === 'a' ? 'border-emerald-500' : 'border-amber-500'} shadow-md">
          <img src="${img2}" class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 ${teamKey === 'a' ? 'border-emerald-400' : 'border-amber-400'} shadow-md">
        </div>
      `;
    } else {
      const p = (teamObj.players && teamObj.players[0]) || { name: teamObj.name, photo_url: teamObj.photo };
      const img = p.photo_url || teamObj.photo || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.name)}`;
      avatarsWrap.innerHTML = `
        <img src="${img}" class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border-2 ${teamKey === 'a' ? 'border-emerald-500/50' : 'border-amber-500/50'} shadow-md">
      `;
    }
  }

  // Doubles individual player chips
  if (chipsWrap) {
    if (isDoubles && teamObj.players && teamObj.players.length >= 2) {
      chipsWrap.classList.remove('hidden');
      chipsWrap.innerHTML = teamObj.players.slice(0, 2).map((player, idx) => {
        const isThisServing = isServingTeam && (activePlayerIdx === idx);
        return `
          <button onclick="handleSelectDoublesServer('team_${teamKey}', ${idx})" title="Klik untuk jadikan server" class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition ${isThisServing ? 'bg-emerald-600 text-white font-bold border border-emerald-400 shadow-sm' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}">
            <span>${isThisServing ? '🎾' : '👤'}</span>
            <span class="truncate max-w-[110px]">${player.name || `Pemain ${idx+1}`}</span>
            ${isThisServing ? '<span class="text-[9px] bg-emerald-950 px-1 py-0.2 rounded font-black text-emerald-300">SERVIS</span>' : ''}
          </button>
        `;
      }).join('');
    } else {
      chipsWrap.classList.add('hidden');
    }
  }
}

// --- Scorer Actions ---
function handlePoint(team) {
  if (!AppState.scorer) return;
  AppState.scorer.addPoint(team);
  updateScoreboardUI();
  syncActiveCourt();
}

function handleUndo() {
  if (!AppState.scorer) return;
  if (AppState.scorer.undo()) {
    showToast('Undo poin berhasil');
    updateScoreboardUI();
    syncActiveCourt();
  }
}

function handleToggleServer() {
  if (!AppState.scorer) return;
  AppState.scorer.toggleServer();
  updateScoreboardUI();
  syncActiveCourt();
  const activePlayer = AppState.scorer.getActiveServerPlayer();
  showToast(`Giliran Servis: ${activePlayer.name}`);
}

function handleSelectDoublesServer(teamKey, playerIdx) {
  if (!AppState.scorer || AppState.scorer.mode !== 'doubles') return;
  AppState.scorer.setDoublesServer(teamKey, playerIdx);
  updateScoreboardUI();
  syncActiveCourt();
  const activePlayer = AppState.scorer.getActiveServerPlayer();
  showToast(`Server ditetapkan: ${activePlayer.name}`);
}

// DEDICATED QUICK DEUCE (40-40) ACTION
function handleQuickDeuce() {
  if (!AppState.scorer) return;
  AppState.scorer.setDeuce();
  updateScoreboardUI();
  syncActiveCourt();
  showToast('⚡ Skor diatur ke DEUCE (40 - 40)!');
}

// TOGGLE GOLDEN POINT ON-THE-FLY
function handleToggleGoldenPoint() {
  if (!AppState.scorer) return;
  const isGold = AppState.scorer.toggleGoldenPoint();
  updateScoreboardUI();
  syncActiveCourt();
  showToast(isGold ? '⭐ Mode Golden Point (No-Ad) Diaktifkan' : '🎾 Mode Deuce & Advantage Standar Diaktifkan');
}

// QUICK EDIT TARGET GAMES (MINI GAME)
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
  updateScoreboardUI();
  syncActiveCourt();
  showToast(`🎯 Target set diubah menjadi ${val} Game!`);
}

function handleDismissSideSwitch() {
  if (AppState.scorer) {
    AppState.scorer.side_switch_alert = false;
    updateScoreboardUI();
  }
}

// --- Walkover / Disqualification Win (Point 1) ---
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

  const winnerObj = winnerTeam === 'team_a' ? AppState.scorer.team_a : AppState.scorer.team_b;
  window.soundEngine.announceWalkoverWin(winnerObj.name, AppState.scorer.win_reason);

  document.getElementById('modal-walkover-win').classList.add('hidden');
  syncActiveCourt();
  updateScoreboardUI();
}

// --- Match Completion Modal & Victory Slogan (Point 4) ---
function showMatchCompletedModal() {
  AppState.modalShown = true;
  const s = AppState.scorer;
  const winnerTeam = s.winner === 'team_a' ? s.team_a : s.team_b;
  const winnerName = winnerTeam.name;

  // Trigger confetti!
  if (window.confetti) {
    window.confetti({ particleCount: 140, spread: 85, origin: { y: 0.6 } });
    setTimeout(() => {
      window.confetti({ particleCount: 90, angle: 60, spread: 55, origin: { x: 0 } });
      window.confetti({ particleCount: 90, angle: 120, spread: 55, origin: { x: 1 } });
    }, 400);
  }

  const modal = document.getElementById('match-finish-modal');
  if (!modal) return;

  document.getElementById('finish-winner-name').textContent = winnerName;

  // Render winner avatars
  const avatarsWrap = document.getElementById('finish-winner-avatars-wrap');
  if (avatarsWrap) {
    if (s.mode === 'doubles' && winnerTeam.players && winnerTeam.players.length >= 2) {
      const p1 = winnerTeam.players[0];
      const p2 = winnerTeam.players[1];
      const img1 = p1.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p1.name || 'W1')}`;
      const img2 = p2.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p2.name || 'W2')}`;
      avatarsWrap.innerHTML = `
        <div class="doubles-avatar-wrap">
          <img src="${img1}" class="w-20 h-20 rounded-3xl object-cover border-4 border-amber-400 shadow-xl">
          <img src="${img2}" class="w-20 h-20 rounded-3xl object-cover border-4 border-amber-300 shadow-xl">
        </div>
      `;
    } else {
      const img = winnerTeam.photo || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(winnerName)}`;
      avatarsWrap.innerHTML = `
        <img src="${img}" class="w-24 h-24 rounded-3xl object-cover border-4 border-amber-400 shadow-xl">
      `;
    }
  }

  // Win reason badge (W.O. / DQ / RET)
  const badgeEl = document.getElementById('finish-win-reason-badge');
  if (badgeEl) {
    if (s.win_type && s.win_type !== 'normal') {
      badgeEl.classList.remove('hidden');
      badgeEl.textContent = s.win_reason || (s.win_type === 'disqualification' ? 'Menang Diskualifikasi (DQ)' : 'Menang W.O.');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  // Score summary
  const scoreSummary = s.sets_history.map(set => `${set.team_a}-${set.team_b}`).join(' | ');
  document.getElementById('finish-score-summary').textContent = `Skor Akhir: ${scoreSummary || 'Game Selesai'}`;
  document.getElementById('finish-duration').textContent = `Durasi: ${Math.max(1, Math.floor(AppState.matchDurationSecs / 60))} Menit`;

  // VICTORY SLOGAN AUDIO PLAYBACK (POINT 4)
  const sloganBox = document.getElementById('finish-slogan-box');
  const sloganTextEl = document.getElementById('finish-slogan-text');

  // Look for a player with recorded slogan or text in the winning team
  let winningPlayerWithSlogan = null;
  if (winnerTeam.players && winnerTeam.players.length > 0) {
    for (const p of winnerTeam.players) {
      // Find full player object from AppState.players to get latest audio
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
    // Trigger audio / speech playback!
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
    showToast('Memutar suara slogan juara...');
  } else {
    showToast('Pemain belum merekam slogan kemenangan.');
  }
}

async function saveAndFinishMatch() {
  const s = AppState.scorer;
  if (!s) return;

  const matchData = s.toJSON();
  matchData.duration_minutes = Math.max(1, Math.round(AppState.matchDurationSecs / 60));

  showToast('Menyimpan pertandingan...');
  const res = await apiPost('/api/matches', matchData);

  // If this match was from a tournament, update tournament bracket!
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

  // Clear this court's active state
  localStorage.removeItem(`padel_court_match_${AppState.currentCourtId}`);
  await fetch(`/api/courts/${AppState.currentCourtId}`, { method: 'DELETE' });

  await loadMatches();
  await loadPlayers();

  document.getElementById('match-finish-modal').classList.add('hidden');
  AppState.modalShown = false;

  let msg = 'Pertandingan berhasil disimpan!';
  if (res && res.sheet_synced) {
    msg += ' Dan tersinkron otomatis ke Google Sheet! 📊';
  }
  showToast(msg);
  switchTab('history');
}

// --- New Match Modal & Inputs Setup ---
function startNewMatchPrompt() {
  document.getElementById('new-match-modal').classList.remove('hidden');
  populateNewMatchPlayerDropdowns();
}

function populateNewMatchPlayerDropdowns() {
  const options = AppState.players.map(p => 
    `<option value="${p.id}" data-name="${p.name}" data-photo="${p.photo_url || ''}">${p.name} (${p.level})</option>`
  ).join('');

  const emptyOpt = `<option value="">-- Pilih Pemain --</option>`;

  // Singles dropdowns
  const selSingleA = document.getElementById('match-player-a-single');
  const selSingleB = document.getElementById('match-player-b-single');
  if (selSingleA) selSingleA.innerHTML = emptyOpt + options;
  if (selSingleB) selSingleB.innerHTML = emptyOpt + options;

  // Doubles dropdowns (4 players)
  const selA1 = document.getElementById('match-doubles-a1');
  const selA2 = document.getElementById('match-doubles-a2');
  const selB1 = document.getElementById('match-doubles-b1');
  const selB2 = document.getElementById('match-doubles-b2');

  [selA1, selA2, selB1, selB2].forEach(sel => {
    if (sel) sel.innerHTML = emptyOpt + options;
  });

  // Pre-select first 4 players if available
  if (AppState.players.length >= 4) {
    if (selA1) selA1.value = AppState.players[0].id;
    if (selA2) selA2.value = AppState.players[1].id;
    if (selB1) selB1.value = AppState.players[2].id;
    if (selB2) selB2.value = AppState.players[3].id;
    autoGenerateDoublesTeamName('a');
    autoGenerateDoublesTeamName('b');
  }
}

function toggleMatchModeInputs(mode) {
  const isDoubles = mode === 'doubles';
  document.getElementById('match-inputs-singles').classList.toggle('hidden', isDoubles);
  document.getElementById('match-inputs-doubles').classList.toggle('hidden', !isDoubles);
}

function syncSinglePlayerName(side) {
  const sel = document.getElementById(`match-player-${side}-single`);
  const input = document.getElementById(`new-match-name-${side}-single`);
  if (sel && input) {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.name) {
      input.value = opt.dataset.name;
    }
  }
}

function autoGenerateDoublesTeamName(side) {
  const sel1 = document.getElementById(`match-doubles-${side}1`);
  const sel2 = document.getElementById(`match-doubles-${side}2`);
  const input = document.getElementById(`new-match-team-name-${side}`);

  let name1 = '';
  let name2 = '';

  if (sel1 && sel1.selectedIndex > 0) {
    name1 = sel1.options[sel1.selectedIndex].dataset.name || '';
  }
  if (sel2 && sel2.selectedIndex > 0) {
    name2 = sel2.options[sel2.selectedIndex].dataset.name || '';
  }

  const short1 = name1 ? name1.split(' ')[0] : `Pemain ${side.toUpperCase()}1`;
  const short2 = name2 ? name2.split(' ')[0] : `Pemain ${side.toUpperCase()}2`;

  if (input) {
    input.value = `${short1} & ${short2}`;
  }
}

function handleGameSelectChange(selectEl, customWrapId, customInputId) {
  const wrap = document.getElementById(customWrapId);
  if (wrap) {
    wrap.classList.toggle('hidden', selectEl.value !== 'custom');
  }
}

function startMatchFromForm(e) {
  if (e) e.preventDefault();

  const sport = document.getElementById('new-match-sport').value;
  const mode = document.getElementById('new-match-mode').value;
  const isDoubles = mode === 'doubles';

  let nameA = '';
  let nameB = '';
  let playersA = [];
  let playersB = [];
  let photoA = '';
  let photoB = '';

  if (isDoubles) {
    // Collect 4 players
    const idA1 = document.getElementById('match-doubles-a1').value;
    const idA2 = document.getElementById('match-doubles-a2').value;
    const idB1 = document.getElementById('match-doubles-b1').value;
    const idB2 = document.getElementById('match-doubles-b2').value;

    const pA1 = AppState.players.find(p => p.id === idA1) || { name: 'Pemain A1', photo_url: '' };
    const pA2 = AppState.players.find(p => p.id === idA2) || { name: 'Pemain A2', photo_url: '' };
    const pB1 = AppState.players.find(p => p.id === idB1) || { name: 'Pemain B1', photo_url: '' };
    const pB2 = AppState.players.find(p => p.id === idB2) || { name: 'Pemain B2', photo_url: '' };

    playersA = [pA1, pA2];
    playersB = [pB1, pB2];

    nameA = document.getElementById('new-match-team-name-a').value.trim() || `${pA1.name} & ${pA2.name}`;
    nameB = document.getElementById('new-match-team-name-b').value.trim() || `${pB1.name} & ${pB2.name}`;
    photoA = pA1.photo_url || pA2.photo_url || '';
    photoB = pB1.photo_url || pB2.photo_url || '';
  } else {
    // Singles: 1v1
    const idA = document.getElementById('match-player-a-single').value;
    const idB = document.getElementById('match-player-b-single').value;
    const pA = AppState.players.find(p => p.id === idA);
    const pB = AppState.players.find(p => p.id === idB);

    nameA = document.getElementById('new-match-name-a-single').value.trim() || (pA ? pA.name : 'Pemain A');
    nameB = document.getElementById('new-match-name-b-single').value.trim() || (pB ? pB.name : 'Pemain B');

    playersA = [pA || { name: nameA, photo_url: '' }];
    playersB = [pB || { name: nameB, photo_url: '' }];
    photoA = (pA && pA.photo_url) || '';
    photoB = (pB && pB.photo_url) || '';
  }

  // Games per set (Mini-game or standard)
  let gamesPerSet = 6;
  const gameSel = document.getElementById('new-match-games').value;
  if (gameSel === 'custom') {
    gamesPerSet = parseInt(document.getElementById('new-match-custom-game').value) || 6;
  } else {
    gamesPerSet = parseInt(gameSel) || 6;
  }

  const setsToWin = parseInt(document.getElementById('new-match-sets').value) || 2;
  const deuceRule = document.querySelector('input[name="match-deuce-rule"]:checked')?.value || 'deuce';
  const goldenPoint = (deuceRule === 'golden_point');

  AppState.scorer = new MatchScorer({
    sport: sport,
    mode: mode,
    court_id: AppState.currentCourtId,
    team_a_name: nameA,
    team_b_name: nameB,
    team_a_players: playersA,
    team_b_players: playersB,
    team_a_photo: photoA,
    team_b_photo: photoB,
    rules: {
      sets_to_win: setsToWin,
      games_per_set: gamesPerSet,
      golden_point: goldenPoint,
      tiebreak_at: gamesPerSet,
      tiebreak_points: 7
    }
  });

  AppState.modalShown = false;
  document.getElementById('new-match-modal').classList.add('hidden');
  startMatchTimer();
  updateScoreboardUI();
  syncActiveCourt();
  switchTab('scorer');
  showToast(`Pertandingan dimulai di ${getCourtDisplayName(AppState.currentCourtId)}: ${nameA} vs ${nameB}`);
}

// --- Tournaments Tab & Doubles Team Builder ---
function renderTournamentsList() {
  const container = document.getElementById('tournaments-list-container');
  if (!container) return;

  if (AppState.tournaments.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-12 bg-slate-900/60 border border-slate-800 rounded-2xl">
        <div class="text-5xl mb-3">🏆</div>
        <h3 class="text-lg font-bold text-white mb-1">Belum Ada Turnamen</h3>
        <p class="text-slate-400 text-sm mb-4">Buat turnamen pertama Anda lengkap dengan bagan gugur (bracket) atau setengah kompetisi.</p>
        <button onclick="openCreateTournamentModal()" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition">
          + Buat Turnamen Baru
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = AppState.tournaments.map(t => {
    const isCompleted = t.status === 'completed';
    const modeLabel = t.mode === 'doubles' ? 'Ganda (2 Org/Tim)' : 'Tunggal';
    return `
      <div class="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-5 transition shadow-lg flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${isCompleted ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'}">
              ${isCompleted ? '🏆 SELESAI' : '🔥 BERJALAN'}
            </span>
            <span class="text-xs text-slate-400 font-mono">${t.format === 'knockout' ? 'Bagan Gugur (Knockout)' : 'Round Robin'}</span>
          </div>
          <h3 class="text-xl font-bold text-white mb-1">${t.name}</h3>
          <p class="text-xs text-slate-400 mb-3">${t.sport.toUpperCase()} • ${modeLabel} • ${t.participants ? t.participants.length : 0} Peserta • Target ${t.rules?.games_per_set || 6} Game</p>
          ${t.champion_name ? `<div class="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm font-bold flex items-center mb-4">👑 Juara: ${t.champion_name}</div>` : ''}
        </div>
        <div class="flex items-center space-x-2 pt-2 border-t border-slate-800">
          <button onclick="viewTournamentBracket('${t.id}')" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition">
            Lihat Bagan & Pertandingan
          </button>
          <button onclick="deleteTournament('${t.id}')" class="p-2 text-slate-400 hover:text-red-400 rounded-xl transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openCreateTournamentModal() {
  document.getElementById('create-tournament-modal').classList.remove('hidden');
  AppState.tourneyDoublesTeams = [];
  populateTournamentParticipantPickers();
  toggleTourneyModeInputs(document.getElementById('tourney-mode').value);
}

function toggleTourneyModeInputs(mode) {
  const isDoubles = mode === 'doubles';
  document.getElementById('tourney-singles-picker').classList.toggle('hidden', isDoubles);
  document.getElementById('tourney-doubles-picker').classList.toggle('hidden', !isDoubles);
}

function populateTournamentParticipantPickers() {
  // 1. Singles list with Select All support (Point 3)
  const singlesContainer = document.getElementById('tourney-participants-list');
  if (singlesContainer) {
    if (AppState.players.length === 0) {
      singlesContainer.innerHTML = `<p class="text-amber-400 text-xs p-3">Belum ada pemain di database. Tambahkan pemain terlebih dahulu!</p>`;
    } else {
      singlesContainer.innerHTML = AppState.players.map(p => `
        <label class="flex items-center space-x-3 p-2 bg-slate-800/80 hover:bg-slate-800 rounded-xl cursor-pointer border border-slate-700">
          <input type="checkbox" name="tourney-players-singles" value="${p.id}" onchange="updateSinglesSelectedCountBadge()" class="w-4 h-4 text-emerald-500 rounded focus:ring-emerald-500 bg-slate-900 border-slate-600">
          <img src="${p.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.name)}`}" class="w-7 h-7 rounded-full object-cover">
          <span class="text-xs font-semibold text-white">${p.name} <span class="text-[11px] text-slate-400">(${p.level})</span></span>
        </label>
      `).join('');
    }
  }
  updateSinglesSelectedCountBadge();

  // 2. Doubles pair selects
  const p1Sel = document.getElementById('tourney-pair-p1');
  const p2Sel = document.getElementById('tourney-pair-p2');
  const options = AppState.players.map(p => `<option value="${p.id}" data-name="${p.name}">${p.name} (${p.level})</option>`).join('');
  const empty = `<option value="">-- Pilih Pemain --</option>`;

  if (p1Sel) p1Sel.innerHTML = empty + options;
  if (p2Sel) p2Sel.innerHTML = empty + options;

  renderFormedDoublesTeamsList();
}

// Select All / Deselect All Handlers (Point 3)
function selectAllSinglesParticipants(isChecked) {
  const checkboxes = document.querySelectorAll('input[name="tourney-players-singles"]');
  checkboxes.forEach(cb => { cb.checked = isChecked; });
  updateSinglesSelectedCountBadge();
}

function updateSinglesSelectedCountBadge() {
  const checked = document.querySelectorAll('input[name="tourney-players-singles"]:checked');
  const badge = document.getElementById('singles-selected-count-badge');
  if (badge) {
    badge.textContent = `(${checked.length} Dipilih)`;
  }
}

function addDoublesTeamToTourney() {
  const p1Sel = document.getElementById('tourney-pair-p1');
  const p2Sel = document.getElementById('tourney-pair-p2');
  const nameInput = document.getElementById('tourney-pair-teamname');

  const id1 = p1Sel.value;
  const id2 = p2Sel.value;

  if (!id1 || !id2) {
    alert('Pilih Pemain 1 dan Pemain 2 untuk membentuk pasangan tim ganda!');
    return;
  }
  if (id1 === id2) {
    alert('Pemain 1 dan Pemain 2 tidak boleh orang yang sama!');
    return;
  }

  const p1 = AppState.players.find(p => p.id === id1);
  const p2 = AppState.players.find(p => p.id === id2);

  const teamName = nameInput.value.trim() || `${p1.name.split(' ')[0]} & ${p2.name.split(' ')[0]}`;

  AppState.tourneyDoublesTeams.push({
    id: `doubles_team_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: teamName,
    mode: 'doubles',
    players: [p1, p2],
    photo_url: p1.photo_url || '',
    photo_url2: p2.photo_url || ''
  });

  nameInput.value = '';
  renderFormedDoublesTeamsList();
  showToast(`Tim "${teamName}" ditambahkan!`);
}

function removeDoublesTeam(index) {
  AppState.tourneyDoublesTeams.splice(index, 1);
  renderFormedDoublesTeamsList();
}

function autoPairDoublesTeams() {
  if (AppState.players.length < 2) {
    alert('Daftarkan minimal 2 pemain terlebih dahulu!');
    return;
  }

  AppState.tourneyDoublesTeams = [];
  const shuffled = [...AppState.players].sort(() => 0.5 - Math.random());

  for (let i = 0; i < shuffled.length - 1; i += 2) {
    const p1 = shuffled[i];
    const p2 = shuffled[i + 1];
    AppState.tourneyDoublesTeams.push({
      id: `doubles_team_${Date.now()}_${i}`,
      name: `${p1.name.split(' ')[0]} & ${p2.name.split(' ')[0]}`,
      mode: 'doubles',
      players: [p1, p2],
      photo_url: p1.photo_url || '',
      photo_url2: p2.photo_url || ''
    });
  }

  renderFormedDoublesTeamsList();
  showToast(`Berhasil memasangkan ${AppState.tourneyDoublesTeams.length} Tim Ganda secara otomatis!`);
}

function renderFormedDoublesTeamsList() {
  const container = document.getElementById('tourney-doubles-teams-list');
  const countBadge = document.getElementById('tourney-teams-count-badge');
  if (!container) return;

  const count = AppState.tourneyDoublesTeams.length;
  if (countBadge) countBadge.textContent = `${count} Tim Terbentuk`;

  if (count === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 text-center py-3">Belum ada tim ganda. Pasangkan pemain di atas atau klik 'Pasangkan Otomatis'!</p>`;
    return;
  }

  container.innerHTML = AppState.tourneyDoublesTeams.map((team, idx) => `
    <div class="flex items-center justify-between p-2 bg-slate-900 border border-slate-700 rounded-xl">
      <div class="flex items-center space-x-2 truncate">
        <span class="text-xs font-bold text-amber-400">#${idx + 1}</span>
        <div class="doubles-avatar-wrap">
          <img src="${team.players[0].photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(team.players[0].name)}`}" class="w-6 h-6 rounded-full object-cover border border-emerald-400">
          <img src="${team.players[1].photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(team.players[1].name)}`}" class="w-6 h-6 rounded-full object-cover border border-emerald-300">
        </div>
        <div class="truncate">
          <span class="text-xs font-bold text-white">${team.name}</span>
          <span class="text-[10px] text-slate-400 block">${team.players[0].name} & ${team.players[1].name}</span>
        </div>
      </div>
      <button type="button" onclick="removeDoublesTeam(${idx})" class="p-1 text-slate-500 hover:text-red-400 rounded-lg">✕</button>
    </div>
  `).join('');
}

async function handleCreateTournament(e) {
  if (e) e.preventDefault();

  const name = document.getElementById('tourney-name').value.trim();
  const sport = document.getElementById('tourney-sport').value;
  const mode = document.getElementById('tourney-mode').value;
  const format = document.getElementById('tourney-format').value;
  const isDoubles = mode === 'doubles';

  let participants = [];

  if (isDoubles) {
    if (AppState.tourneyDoublesTeams.length < 2) {
      alert('Bentuk minimal 2 tim pasangan ganda untuk turnamen!');
      return;
    }
    participants = AppState.tourneyDoublesTeams.map(t => ({
      id: t.id,
      name: t.name,
      mode: 'doubles',
      players: t.players,
      photo_url: t.photo_url || '',
      photo_url2: t.photo_url2 || ''
    }));
  } else {
    // Singles
    const checkedBoxes = Array.from(document.querySelectorAll('input[name="tourney-players-singles"]:checked'));
    const selectedIds = checkedBoxes.map(cb => cb.value);

    if (selectedIds.length < 2) {
      alert('Pilih minimal 2 peserta tunggal untuk turnamen!');
      return;
    }

    participants = selectedIds.map(id => {
      const p = AppState.players.find(x => x.id === id);
      return {
        id: p.id,
        name: p.name,
        photo_url: p.photo_url || '',
        players: [p]
      };
    });
  }

  // Games per set
  let gamesPerSet = 6;
  const gameSel = document.getElementById('tourney-games').value;
  if (gameSel === 'custom') {
    gamesPerSet = parseInt(document.getElementById('tourney-custom-game').value) || 6;
  } else {
    gamesPerSet = parseInt(gameSel) || 6;
  }

  const rules = {
    sets_to_win: parseInt(document.getElementById('tourney-sets').value) || 2,
    games_per_set: gamesPerSet,
    golden_point: document.getElementById('tourney-golden-point').checked,
    tiebreak_at: gamesPerSet
  };

  let newTourney = null;
  if (format === 'knockout') {
    newTourney = TournamentManager.createKnockoutTournament(name, sport, mode, participants, rules);
  } else {
    newTourney = TournamentManager.createRoundRobinTournament(name, sport, mode, participants, rules);
  }

  const res = await apiPost('/api/tournaments', newTourney);
  await loadTournaments();
  document.getElementById('create-tournament-modal').classList.add('hidden');
  renderTournamentsList();
  showToast('Turnamen berhasil dibuat!');

  if (res && res.id) {
    viewTournamentBracket(res.id);
  }
}

// --- Bracket View & Custom Seeding / Swapping (Point 2 & Point 6) ---
function viewTournamentBracket(tournId) {
  const tourney = AppState.tournaments.find(t => t.id === tournId);
  if (!tourney) return;

  AppState.selectedTournament = tourney;
  document.getElementById('bracket-modal').classList.remove('hidden');
  document.getElementById('bracket-tourn-title').textContent = tourney.name;
  
  const modeText = tourney.mode === 'doubles' ? 'Ganda (2 Pemain per Tim)' : 'Tunggal';
  document.getElementById('bracket-tourn-subtitle').textContent = `${tourney.sport.toUpperCase()} • ${modeText} • Target ${tourney.rules?.games_per_set || 6} Game • ${tourney.format === 'knockout' ? 'Bagan Gugur (Knockout)' : 'Round Robin'}`;

  renderBracketContent(tourney);
}

function renderBracketContent(tourney) {
  const container = document.getElementById('bracket-visual-container');
  if (!container) return;

  if (tourney.format === 'knockout') {
    renderKnockoutTree(tourney, container);
  } else {
    renderRoundRobinView(tourney, container);
  }
}

function renderKnockoutTree(tourney, container) {
  let html = `<div class="bracket-container">`;

  tourney.rounds.forEach(round => {
    html += `
      <div class="bracket-round">
        <div class="text-center pb-3 border-b border-slate-700 mb-4">
          <span class="text-xs font-bold uppercase tracking-wider text-emerald-400">${round.name}</span>
        </div>
        <div class="flex flex-col justify-around h-full space-y-6">
    `;

    round.matches.forEach(m => {
      const isComplete = m.status === 'completed';
      const pA = m.team_a;
      const pB = m.team_b;
      const canStart = pA && pB && !pA.is_bye && !pB.is_bye && !isComplete;

      // Status / Score pill with Win reason if DQ or Walkover (Point 2)
      let scoreBadge = '';
      if (m.win_type && isComplete) {
        scoreBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-red-950/80 text-red-300 border border-red-500/40">${m.score_display || m.win_reason || 'W.O.'}</span>`;
      } else {
        scoreBadge = `<span class="font-mono text-emerald-400 font-bold">${m.score_display || 'vs'}</span>`;
      }

      html += `
        <div class="bracket-match ${isComplete ? 'completed' : ''}">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Match #${m.match_number}</span>
            ${scoreBadge}
          </div>

          <!-- Team A -->
          <div class="flex items-center justify-between p-2 rounded-lg ${m.winner === 'team_a' ? 'bg-emerald-950/60 border border-emerald-500/50' : 'bg-slate-800/60'} mb-1.5">
            <div class="flex items-center space-x-2 truncate">
              ${renderParticipantAvatar(pA)}
              <div class="truncate">
                <span class="text-xs font-semibold ${m.winner === 'team_a' ? 'text-emerald-400' : 'text-white'} truncate block">${pA ? pA.name : 'TBD'}</span>
                ${renderParticipantSubtext(pA)}
              </div>
            </div>
            ${m.winner === 'team_a' ? '<span class="text-emerald-400 text-xs font-bold">👑 W</span>' : ''}
          </div>

          <!-- Team B -->
          <div class="flex items-center justify-between p-2 rounded-lg ${m.winner === 'team_b' ? 'bg-emerald-950/60 border border-emerald-500/50' : 'bg-slate-800/60'}">
            <div class="flex items-center space-x-2 truncate">
              ${renderParticipantAvatar(pB)}
              <div class="truncate">
                <span class="text-xs font-semibold ${m.winner === 'team_b' ? 'text-emerald-400' : 'text-white'} truncate block">${pB ? pB.name : 'TBD'}</span>
                ${renderParticipantSubtext(pB)}
              </div>
            </div>
            ${m.winner === 'team_b' ? '<span class="text-emerald-400 text-xs font-bold">👑 W</span>' : ''}
          </div>

          ${canStart ? `
            <div class="mt-2.5 flex items-center space-x-1.5">
              <button onclick="startTournamentMatch('${tourney.id}', '${m.id}')" class="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition flex items-center justify-center space-x-1">
                <span>🎾 Mulai Skor</span>
              </button>
              <button onclick="openBracketWalkoverPrompt('${tourney.id}', '${m.id}')" title="Kemenangan W.O. / Gugur / Diskualifikasi" class="px-2.5 py-1.5 bg-red-600/25 hover:bg-red-600/40 text-red-300 hover:text-white font-bold rounded-lg text-xs border border-red-500/40 transition">
                W.O./DQ
              </button>
            </div>
          ` : ''}
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function renderParticipantAvatar(p) {
  if (!p) {
    return `<div class="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-slate-400">?</div>`;
  }
  if (p.is_bye) {
    return `<span class="text-xs">👋</span>`;
  }
  if (p.players && p.players.length >= 2) {
    const img1 = p.players[0].photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.players[0].name)}`;
    const img2 = p.players[1].photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.players[1].name)}`;
    return `
      <div class="doubles-avatar-wrap">
        <img src="${img1}" class="w-5 h-5 rounded-full object-cover border border-emerald-400">
        <img src="${img2}" class="w-5 h-5 rounded-full object-cover border border-emerald-300">
      </div>
    `;
  }
  return `<img src="${p.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.name)}`}" class="w-6 h-6 rounded-full object-cover">`;
}

function renderParticipantSubtext(p) {
  if (!p || p.is_bye || !p.players || p.players.length < 2) return '';
  return `<span class="text-[10px] text-slate-400 block truncate">${p.players[0].name} & ${p.players[1].name}</span>`;
}

function renderRoundRobinView(tourney, container) {
  const standings = TournamentManager.calculateStandings(tourney);

  let html = `
    <div class="space-y-6">
      <!-- Standings Table -->
      <div>
        <h4 class="text-sm font-bold text-white mb-2">📊 Klasemen Sementara</h4>
        <div class="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-800 text-slate-300 font-bold uppercase">
              <tr>
                <th class="p-3">Pos</th>
                <th class="p-3">Peserta</th>
                <th class="p-3 text-center">Main</th>
                <th class="p-3 text-center">M</th>
                <th class="p-3 text-center">K</th>
                <th class="p-3 text-center">Set +/-</th>
                <th class="p-3 text-center">Game +/-</th>
                <th class="p-3 text-center font-bold text-emerald-400">Poin</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800">
              ${standings.map((s, idx) => `
                <tr class="hover:bg-slate-800/40">
                  <td class="p-3 font-bold ${idx === 0 ? 'text-amber-400' : 'text-slate-400'}">#${idx + 1}</td>
                  <td class="p-3 flex items-center space-x-2">
                    ${renderParticipantAvatar(s.participant)}
                    <div>
                      <span class="font-bold text-white block">${s.participant.name}</span>
                      ${renderParticipantSubtext(s.participant)}
                    </div>
                  </td>
                  <td class="p-3 text-center font-mono">${s.played}</td>
                  <td class="p-3 text-center font-mono text-emerald-400 font-bold">${s.won}</td>
                  <td class="p-3 text-center font-mono text-red-400">${s.lost}</td>
                  <td class="p-3 text-center font-mono text-slate-300">${s.sets_won - s.sets_lost}</td>
                  <td class="p-3 text-center font-mono text-slate-300">${s.games_won - s.games_lost}</td>
                  <td class="p-3 text-center font-mono font-bold text-emerald-400 text-sm">${s.points}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Matches Schedule -->
      <div>
        <h4 class="text-sm font-bold text-white mb-2">📅 Jadwal & Hasil Pertandingan</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${tourney.rounds.flatMap(r => r.matches.map(m => {
            const isComplete = m.status === 'completed';
            const canStart = m.team_a && m.team_b && !isComplete;

            let badgeHtml = '';
            if (m.win_type && isComplete) {
              badgeHtml = `<span class="text-[10px] font-black text-red-300 bg-red-950/80 px-2 py-0.5 rounded border border-red-500/40">${m.score_display || 'W.O.'}</span>`;
            } else if (isComplete) {
              badgeHtml = `<span class="text-xs font-bold text-emerald-400 font-mono px-2 py-1 bg-emerald-950/60 rounded">${m.score_display || 'Selesai'}</span>`;
            }

            return `
              <div class="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between">
                <div>
                  <div class="text-xs text-slate-400 mb-1">${r.name} • Match #${m.match_number}</div>
                  <div class="text-sm font-bold text-white">${m.team_a.name} <span class="text-emerald-400 font-mono">${m.score_display || 'vs'}</span> ${m.team_b.name}</div>
                </div>
                <div class="flex items-center space-x-1.5">
                  ${canStart ? `
                    <button onclick="startTournamentMatch('${tourney.id}', '${m.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs">
                      Skor 🎾
                    </button>
                    <button onclick="openBracketWalkoverPrompt('${tourney.id}', '${m.id}')" class="px-2 py-1.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded-lg text-xs font-bold border border-red-500/40">
                      W.O.
                    </button>
                  ` : badgeHtml}
                </div>
              </div>
            `;
          })).join('')}
        </div>
      </div>
    </div>
  `;
  container.innerHTML = html;
}

function startTournamentMatch(tournId, matchId) {
  const tourney = AppState.tournaments.find(t => t.id === tournId);
  if (!tourney) return;

  let targetMatch = null;
  for (const r of tourney.rounds) {
    for (const m of r.matches) {
      if (m.id === matchId) {
        targetMatch = m;
        break;
      }
    }
  }

  if (!targetMatch || !targetMatch.team_a || !targetMatch.team_b) return;

  AppState.scorer = new MatchScorer({
    sport: tourney.sport || 'padel',
    mode: tourney.mode || 'singles',
    court_id: AppState.currentCourtId,
    tournament_id: tourney.id,
    tournament_match_id: targetMatch.id,
    tournament_name: tourney.name,
    team_a_name: targetMatch.team_a.name,
    team_b_name: targetMatch.team_b.name,
    team_a_players: targetMatch.team_a.players || [targetMatch.team_a],
    team_b_players: targetMatch.team_b.players || [targetMatch.team_b],
    team_a_photo: targetMatch.team_a.photo_url || '',
    team_b_photo: targetMatch.team_b.photo_url || '',
    rules: tourney.rules || {
      sets_to_win: 2,
      games_per_set: 6,
      golden_point: false,
      tiebreak_at: 6,
      tiebreak_points: 7
    }
  });

  document.getElementById('bracket-modal').classList.add('hidden');
  startMatchTimer();
  updateScoreboardUI();
  syncActiveCourt();
  switchTab('scorer');
  showToast(`Match Turnamen Dimulai di ${getCourtDisplayName(AppState.currentCourtId)}: ${targetMatch.team_a.name} vs ${targetMatch.team_b.name}`);
}

// Quick Walkover / DQ prompt directly in tournament bracket (Point 1 & 2)
async function openBracketWalkoverPrompt(tournId, matchId) {
  const tourney = AppState.tournaments.find(t => t.id === tournId);
  if (!tourney) return;

  let targetMatch = null;
  for (const r of tourney.rounds) {
    for (const m of r.matches) {
      if (m.id === matchId) {
        targetMatch = m;
        break;
      }
    }
  }
  if (!targetMatch) return;

  const winnerChoice = prompt(`Pilih Tim Pemenang:\n1. Tim A: ${targetMatch.team_a.name}\n2. Tim B: ${targetMatch.team_b.name}\n\nKetik 1 atau 2:`, "1");
  if (!winnerChoice || (winnerChoice !== "1" && winnerChoice !== "2")) return;

  const winnerSlot = winnerChoice === "1" ? "team_a" : "team_b";
  const winnerName = winnerChoice === "1" ? targetMatch.team_a.name : targetMatch.team_b.name;

  const reasonChoice = prompt("Pilih Alasan Kemenangan:\n1. Lawan Tidak Hadir (Walkover / W.O.)\n2. Kena Diskualifikasi (DQ)\n3. Lawan Mundur / Cedera (RET)\n\nKetik 1, 2, atau 3:", "1");
  let reasonType = 'walkover';
  let reasonStr = 'W.O. (Tidak Hadir)';
  if (reasonChoice === "2") {
    reasonType = 'disqualification';
    reasonStr = 'W.O. (Diskualifikasi)';
  } else if (reasonChoice === "3") {
    reasonType = 'retired';
    reasonStr = 'Mundur / Cedera (RET)';
  }

  TournamentManager.recordWalkover(tourney, matchId, winnerSlot, reasonType, reasonStr);

  await fetch(`/api/tournaments/${tourney.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tourney)
  });

  await loadTournaments();
  renderBracketContent(tourney);
  showToast(`Kemenangan ${reasonStr} untuk ${winnerName} berhasil dicatat di bagan!`);
}

// --- Custom Seed / Match Swap in Bracket (Point 6) ---
function openSwapBracketModal() {
  const tourney = AppState.selectedTournament;
  if (!tourney || !tourney.rounds || tourney.rounds.length === 0) {
    alert('Buka turnamen terlebih dahulu!');
    return;
  }

  const r1 = tourney.rounds[0];
  const select1 = document.getElementById('swap-slot-1');
  const select2 = document.getElementById('swap-slot-2');
  if (!select1 || !select2) return;

  let optionsHtml = '';
  r1.matches.forEach((m, matchIdx) => {
    const isCompleted = m.status === 'completed' && !m.team_b?.is_bye;
    const disabled = isCompleted ? 'disabled' : '';

    if (m.team_a) {
      optionsHtml += `<option value="${matchIdx}:team_a" ${disabled}>Match #${m.match_number} [Slot A]: ${m.team_a.name} ${isCompleted ? '(Selesai)' : ''}</option>`;
    }
    if (m.team_b) {
      optionsHtml += `<option value="${matchIdx}:team_b" ${disabled}>Match #${m.match_number} [Slot B]: ${m.team_b.name} ${isCompleted ? '(Selesai)' : ''}</option>`;
    }
  });

  select1.innerHTML = optionsHtml;
  select2.innerHTML = optionsHtml;

  // Set default to different slots
  if (select2.options.length > 1) {
    select2.selectedIndex = 1;
  }

  document.getElementById('modal-swap-bracket').classList.remove('hidden');
}

async function confirmSwapParticipants() {
  const tourney = AppState.selectedTournament;
  if (!tourney) return;

  const val1 = document.getElementById('swap-slot-1').value;
  const val2 = document.getElementById('swap-slot-2').value;

  if (val1 === val2) {
    alert('Pilih dua peserta yang berbeda untuk ditukar!');
    return;
  }

  const [idx1Str, slot1] = val1.split(':');
  const [idx2Str, slot2] = val2.split(':');
  const idx1 = parseInt(idx1Str);
  const idx2 = parseInt(idx2Str);

  const res = TournamentManager.swapRound1Participants(tourney, idx1, slot1, idx2, slot2);
  if (!res.success) {
    alert(res.message || 'Gagal menukar posisi peserta');
    return;
  }

  // Persist to server
  await fetch(`/api/tournaments/${tourney.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tourney)
  });

  await loadTournaments();
  renderBracketContent(tourney);
  openSwapBracketModal(); // Refresh options
  showToast('Posisi peserta pada bagan berhasil ditukar!');
}

async function handleReshuffleBracket() {
  const tourney = AppState.selectedTournament;
  if (!tourney) return;

  if (!confirm('Acak ulang seluruh susunan bagan Babak 1? Semua pertandingan yang belum selesai akan diacak kembali.')) {
    return;
  }

  const res = TournamentManager.reshuffleRound1(tourney);
  if (!res.success) {
    alert(res.message || 'Gagal mengacak ulang');
    return;
  }

  await fetch(`/api/tournaments/${tourney.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tourney)
  });

  await loadTournaments();
  renderBracketContent(tourney);
  document.getElementById('modal-swap-bracket').classList.add('hidden');
  showToast('Bagan pertandingan berhasil diacak ulang!');
}

async function deleteTournament(id) {
  if (!confirm('Yakin ingin menghapus turnamen ini?')) return;
  await fetch(`/api/tournaments/${id}`, { method: 'DELETE' });
  await loadTournaments();
  renderTournamentsList();
  showToast('Turnamen telah dihapus.');
}

// --- Players Tab & Voice Slogan Recording (Point 4) ---
function renderPlayersTab() {
  const container = document.getElementById('players-grid-container');
  if (!container) return;

  if (AppState.players.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-12 bg-slate-900/60 border border-slate-800 rounded-2xl">
        <div class="text-5xl mb-3">👤</div>
        <h3 class="text-lg font-bold text-white mb-1">Belum Ada Pemain Terdaftar</h3>
        <p class="text-slate-400 text-sm mb-4">Tambahkan profil pemain tenis/padel beserta foto dan rekaman voice slogan untuk memulai.</p>
        <button onclick="openPlayerModal()" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition">
          + Tambah Pemain Baru
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = AppState.players.map(p => {
    const played = p.matches_played || 0;
    const won = p.matches_won || 0;
    const rate = played > 0 ? Math.round((won / played) * 100) : 0;
    const photo = p.photo_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.name)}`;
    const hasAudio = !!p.slogan_audio_url;

    return `
      <div class="bg-slate-900 border border-slate-800 hover:border-emerald-500/40 rounded-2xl p-5 transition flex flex-col justify-between shadow-lg">
        <div>
          <div class="flex items-start space-x-4 mb-3">
            <img src="${photo}" alt="${p.name}" class="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/50 shadow-md">
            <div class="flex-1 truncate">
              <h3 class="text-lg font-bold text-white truncate">${p.name}</h3>
              ${p.nickname ? `<p class="text-xs text-emerald-400 font-medium">"${p.nickname}"</p>` : ''}
              <div class="flex items-center space-x-1.5 mt-1">
                <span class="px-2 py-0.5 bg-slate-800 rounded text-[11px] text-slate-300 font-medium">${p.level || 'Intermediate'}</span>
                <span class="px-2 py-0.5 bg-slate-800 rounded text-[11px] text-slate-400 font-medium">${p.handedness || 'Kanan'}</span>
              </div>
            </div>
          </div>

          <!-- Slogan Badge -->
          ${p.slogan_text || hasAudio ? `
            <div class="p-2.5 bg-purple-950/40 border border-purple-500/30 rounded-xl mb-3 flex items-center justify-between">
              <div class="truncate pr-2">
                <span class="text-[10px] uppercase font-bold text-purple-300 flex items-center space-x-1">
                  <span>🎙️</span> <span>Slogan Juara:</span>
                </span>
                <p class="text-xs text-white italic truncate">"${p.slogan_text || 'Suara Rekaman'}"</p>
              </div>
              ${hasAudio ? `
                <button onclick="window.soundEngine.playAudioUrl('${p.slogan_audio_url}')" title="Putar Suara Rekaman" class="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1">
                  <span>▶️</span>
                </button>
              ` : ''}
            </div>
          ` : ''}
        </div>

        <div>
          <!-- Win rate bar -->
          <div class="mb-3">
            <div class="flex justify-between text-xs mb-1">
              <span class="text-slate-400">Win Rate (${won}/${played})</span>
              <span class="font-bold text-emerald-400">${rate}%</span>
            </div>
            <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div class="bg-emerald-500 h-full rounded-full transition-all duration-500" style="width: ${rate}%"></div>
            </div>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
            <button onclick="editPlayer('${p.id}')" class="text-slate-300 hover:text-emerald-400 font-semibold transition">Edit & Voice</button>
            <button onclick="deletePlayer('${p.id}')" class="text-slate-500 hover:text-red-400 transition">Hapus</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openPlayerModal(player = null) {
  const modal = document.getElementById('player-modal');
  modal.classList.remove('hidden');

  document.getElementById('player-form-id').value = player ? player.id : '';
  document.getElementById('player-form-name').value = player ? player.name : '';
  document.getElementById('player-form-nickname').value = player ? player.nickname : '';
  document.getElementById('player-form-hand').value = player ? player.handedness : 'Kanan';
  document.getElementById('player-form-level').value = player ? player.level : 'Intermediate';
  document.getElementById('player-form-notes').value = player ? player.notes || '' : '';
  document.getElementById('player-form-photo-url').value = player ? player.photo_url || '' : '';
  document.getElementById('player-form-slogan-text').value = player ? player.slogan_text || '' : '';
  document.getElementById('player-form-slogan-audio-url').value = player ? player.slogan_audio_url || '' : '';

  const preview = document.getElementById('player-photo-preview');
  preview.src = (player && player.photo_url) || 'https://api.dicebear.com/7.x/bottts/svg?seed=new';

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

  // Reset recording state
  if (AppState.isRecordingVoice) {
    toggleVoiceRecording();
  }
}

function compressImageToDataURL(file, maxSize = 280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxSize) {
          h = Math.round((h * maxSize) / w);
          w = maxSize;
        } else if (h >= w && h > maxSize) {
          w = Math.round((w * maxSize) / h);
          h = maxSize;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
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
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handlePlayerPhotoUpload(file) {
  if (!file) return;
  showToast('Memproses & mengupload foto pemain...');
  try {
    const compressedDataUrl = await compressImageToDataURL(file, 280, 0.8);
    document.getElementById('player-form-photo-url').value = compressedDataUrl;
    document.getElementById('player-photo-preview').src = compressedDataUrl;
    showToast('Foto berhasil diupload!');
  } catch (e) {
    // Fallback to server upload
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-photo', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        document.getElementById('player-form-photo-url').value = data.url;
        document.getElementById('player-photo-preview').src = data.url;
        showToast('Foto berhasil diupload!');
      }
    } catch (err) {
      showToast('Gagal mengupload foto.');
    }
  }
}

// MediaRecorder Voice Slogan Recording (Point 4)
async function toggleVoiceRecording() {
  const btnIcon = document.getElementById('record-btn-icon');
  const btnText = document.getElementById('record-btn-text');
  const timerEl = document.getElementById('record-timer');

  if (!AppState.isRecordingVoice) {
    // START RECORDING
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Browser Anda tidak mendukung perekaman audio mikrofon atau izin ditolak.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      AppState.audioChunks = [];
      AppState.mediaRecorder = new MediaRecorder(stream);

      AppState.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          AppState.audioChunks.push(e.data);
        }
      };

      AppState.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(AppState.audioChunks, { type: 'audio/webm' });
        await uploadRecordedAudioBlob(audioBlob);
      };

      AppState.mediaRecorder.start();
      AppState.isRecordingVoice = true;
      AppState.recordDurationSecs = 0;

      if (btnIcon) btnIcon.textContent = '⏹️';
      if (btnText) btnText.textContent = 'Selesai Rekam';
      if (timerEl) {
        timerEl.classList.remove('hidden');
        timerEl.textContent = '00:00 🔴';
      }

      AppState.recordTimerInterval = setInterval(() => {
        AppState.recordDurationSecs++;
        const m = Math.floor(AppState.recordDurationSecs / 60);
        const s = AppState.recordDurationSecs % 60;
        if (timerEl) {
          timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} 🔴`;
        }
      }, 1000);

      showToast('Merekam suara... Ucapkan slogan kemenangan Anda!');
    } catch (err) {
      console.error('Microphone access error:', err);
      alert('Tidak dapat mengakses mikrofon: ' + err.message);
    }
  } else {
    // STOP RECORDING
    if (AppState.mediaRecorder && AppState.mediaRecorder.state !== 'inactive') {
      AppState.mediaRecorder.stop();
      AppState.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    AppState.isRecordingVoice = false;
    if (AppState.recordTimerInterval) {
      clearInterval(AppState.recordTimerInterval);
      AppState.recordTimerInterval = null;
    }

    if (btnIcon) btnIcon.textContent = '🎙️';
    if (btnText) btnText.textContent = 'Rekam Ulang';
    if (timerEl) timerEl.classList.add('hidden');
  }
}

async function uploadRecordedAudioBlob(blob) {
  showToast('Menyimpan rekaman suara...');
  try {
    const dataUrl = await blobToDataURL(blob);
    document.getElementById('player-form-slogan-audio-url').value = dataUrl;
    const preview = document.getElementById('player-slogan-audio-preview');
    if (preview) {
      preview.src = dataUrl;
      preview.classList.remove('hidden');
    }
    showToast('Suara slogan kemenangan berhasil direkam!');
  } catch (e) {
    showToast('Gagal menyimpan audio rekaman.');
  }
}

async function handleAudioFileUpload(file) {
  if (!file) return;
  showToast('Memproses file audio...');
  try {
    const dataUrl = await blobToDataURL(file);
    document.getElementById('player-form-slogan-audio-url').value = dataUrl;
    const preview = document.getElementById('player-slogan-audio-preview');
    if (preview) {
      preview.src = dataUrl;
      preview.classList.remove('hidden');
    }
    showToast('File audio slogan berhasil diupload!');
  } catch (e) {
    showToast('Gagal mengupload file audio.');
  }
}

async function handleSavePlayer(e) {
  if (e) e.preventDefault();

  const id = document.getElementById('player-form-id').value;
  const playerData = {
    name: document.getElementById('player-form-name').value.trim(),
    nickname: document.getElementById('player-form-nickname').value.trim(),
    handedness: document.getElementById('player-form-hand').value,
    level: document.getElementById('player-form-level').value,
    notes: document.getElementById('player-form-notes').value.trim(),
    photo_url: document.getElementById('player-form-photo-url').value.trim(),
    slogan_text: document.getElementById('player-form-slogan-text').value.trim(),
    slogan_audio_url: document.getElementById('player-form-slogan-audio-url').value.trim()
  };

  if (!playerData.name) {
    alert('Nama pemain wajib diisi!');
    return;
  }

  if (id) {
    await fetch(`/api/players/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playerData)
    });
    showToast('Profil pemain berhasil diperbarui!');
  } else {
    await apiPost('/api/players', playerData);
    showToast('Pemain baru berhasil ditambahkan!');
  }

  await loadPlayers();
  document.getElementById('player-modal').classList.add('hidden');
  renderPlayersTab();
}

function editPlayer(id) {
  const p = AppState.players.find(x => x.id === id);
  if (p) openPlayerModal(p);
}

async function deletePlayer(id) {
  if (!confirm('Yakin ingin menghapus pemain ini?')) return;
  await fetch(`/api/players/${id}`, { method: 'DELETE' });
  await loadPlayers();
  renderPlayersTab();
  showToast('Pemain telah dihapus.');
}

// --- History Tab ---
function renderHistoryTab() {
  const container = document.getElementById('history-list-container');
  if (!container) return;

  if (AppState.matches.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-slate-900/60 border border-slate-800 rounded-2xl">
        <div class="text-5xl mb-3">📋</div>
        <h3 class="text-lg font-bold text-white mb-1">Belum Ada Riwayat Pertandingan</h3>
        <p class="text-slate-400 text-sm mb-4">Selesaikan pertandingan pertama Anda untuk melihat rekapitulasi skor.</p>
        <button onclick="switchTab('scorer')" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition">
          Mulai Pertandingan
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = AppState.matches.map(m => {
    const winnerName = m.winner === 'team_a' ? m.team_a_name : m.team_b_name;
    const scoreStr = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(', ');

    return `
      <div class="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl transition flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center space-x-2 text-xs text-slate-400 mb-1">
            <span>📅 ${m.date || '-'}</span>
            <span>•</span>
            <span class="font-bold uppercase text-emerald-400">${m.sport || 'Tennis'}</span>
            <span class="font-bold uppercase text-purple-400">• ${m.mode === 'doubles' ? 'Ganda' : 'Tunggal'}</span>
            ${m.court_id ? `<span>• 🏟️ ${getCourtDisplayName(m.court_id)}</span>` : ''}
            ${m.tournament_name ? `<span>• 🏆 ${m.tournament_name}</span>` : ''}
          </div>
          <div class="text-base font-bold text-white">
            <span class="${m.winner === 'team_a' ? 'text-emerald-400' : ''}">${m.team_a_name}</span>
            <span class="text-slate-500 mx-2">vs</span>
            <span class="${m.winner === 'team_b' ? 'text-emerald-400' : ''}">${m.team_b_name}</span>
          </div>
          <div class="text-xs text-slate-400 mt-1">
            Pemenang: <span class="font-bold text-emerald-400">${winnerName}</span> 
            ${m.win_reason ? `<span class="ml-2 font-bold text-red-400">[${m.win_reason}]</span>` : ''}
            • Target: ${m.rules?.games_per_set || 6} Game • Durasi: ${m.duration_minutes || 0} mnt
          </div>
        </div>

        <div class="flex items-center space-x-3">
          <div class="px-4 py-2 bg-slate-800 rounded-xl font-mono font-bold text-sm text-emerald-400 border border-slate-700">
            ${m.win_reason || scoreStr || 'Selesai'}
          </div>
          <button onclick="deleteMatchHistory('${m.id}')" class="p-2 text-slate-500 hover:text-red-400 rounded-xl transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteMatchHistory(id) {
  if (!confirm('Hapus riwayat pertandingan ini?')) return;
  await fetch(`/api/matches/${id}`, { method: 'DELETE' });
  await loadMatches();
  renderHistoryTab();
  showToast('Riwayat pertandingan dihapus.');
}

// --- Settings & Google Sheet Tab ---
function renderSettingsTab() {
  const urlInput = document.getElementById('setting-google-sheet-url');
  const autoSyncCheck = document.getElementById('setting-auto-sync');
  const langSelect = document.getElementById('setting-voice-lang');

  if (urlInput) urlInput.value = AppState.settings.google_sheet_url || '';
  if (autoSyncCheck) autoSyncCheck.checked = AppState.settings.auto_sync_sheets ?? true;
  if (langSelect) langSelect.value = AppState.settings.voice_lang || 'id-ID';

  const localIpEl = document.getElementById('settings-local-ip');
  if (localIpEl && AppState.systemInfo.network_url) {
    localIpEl.textContent = AppState.systemInfo.network_url;
  }
}

async function handleSaveSettings(e) {
  if (e) e.preventDefault();

  const google_sheet_url = document.getElementById('setting-google-sheet-url').value.trim();
  const auto_sync_sheets = document.getElementById('setting-auto-sync').checked;
  const voice_lang = document.getElementById('setting-voice-lang').value;

  const data = {
    google_sheet_url,
    auto_sync_sheets,
    voice_lang
  };

  await apiPost('/api/settings', data);
  await loadSettings();
  showToast('Pengaturan berhasil disimpan!');
}

async function testGoogleSheetConnection() {
  const url = document.getElementById('setting-google-sheet-url').value.trim();
  if (!url) {
    alert('Isi URL Webhook Google Sheet terlebih dahulu!');
    return;
  }

  showToast('Menguji koneksi ke Google Sheet...');
  const res = await apiPost('/api/test-sheet-connection', { google_sheet_url: url });

  if (res && res.status === 'success') {
    alert('✅ KONEKSI BERHASIL!\nGoogle Sheet siap menerima data dari aplikasi.');
  } else {
    alert(`❌ GAGAL KONEKSI:\n${res ? res.message : 'Tidak ada respon'}`);
  }
}

async function triggerBulkSheetSync() {
  showToast('Mengirim seluruh data ke Google Sheet...');
  const res = await apiPost('/api/sync-sheets', {});
  if (res && res.status === 'success') {
    alert('✅ SINKRONISASI BERHASIL!\nData Pertandingan, Pemain & Turnamen telah diperbarui di Google Sheet Anda.');
  } else {
    alert(`❌ GAGAL SINKRONISASI:\n${res ? res.message : 'Gagal terhubung'}`);
  }
}

function openSheetTutorialModal() {
  document.getElementById('sheet-tutorial-modal').classList.remove('hidden');
}

function copyAppsScriptCode() {
  fetch('/google_apps_script.js')
    .then(r => r.text())
    .then(code => {
      navigator.clipboard.writeText(code).then(() => {
        showToast('Kode Google Apps Script disalin ke clipboard!');
      });
    })
    .catch(() => {
      showToast('Gagal membaca file kode script.');
    });
}

// --- Toast Notification ---
function showToast(message) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 bg-slate-900 border border-emerald-500 text-white rounded-xl shadow-2xl text-sm font-semibold transition transform duration-300 pointer-events-none flex items-center space-x-2';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>🎾</span> <span>${message}</span>`;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
  }, 2800);
}

function downloadExcelReport(e) {
  if (e) e.preventDefault();
  if (window.XLSX) {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Pertandingan
      const matchRows = (AppState.matches || []).map(m => {
        const setsScores = (m.sets_history || []).map(s => `${s.team_a}-${s.team_b}`).join(' | ');
        const winnerName = m.winner === 'team_a' ? m.team_a_name : m.winner === 'team_b' ? m.team_b_name : '-';
        return {
          'ID Pertandingan': m.id || '',
          'Tanggal': m.date || '',
          'Olahraga': (m.sport || 'padel').toUpperCase(),
          'Mode': (m.mode || 'doubles').toUpperCase(),
          'Tim / Pemain A': m.team_a_name || '',
          'Tim / Pemain B': m.team_b_name || '',
          'Skor Set': setsScores,
          'Pemenang': winnerName,
          'Status Menang': m.win_reason || 'Normal (Skor)',
          'Turnamen': m.tournament_name || 'Friendly Match',
          'Durasi (Menit)': m.duration_minutes || 0
        };
      });
      const wsMatches = XLSX.utils.json_to_sheet(
        matchRows.length > 0 ? matchRows : [{ 'Info': 'Belum ada data pertandingan' }]
      );
      XLSX.utils.book_append_sheet(wb, wsMatches, 'Pertandingan');

      // Sheet 2: Klasemen Pemain
      const playerRows = (AppState.players || []).map(p => {
        const played = p.matches_played || 0;
        const won = p.matches_won || 0;
        const winRate = played > 0 ? Math.round((won / played) * 1000) / 10 : 0;
        return {
          'ID Pemain': p.id || '',
          'Nama': p.name || '',
          'Panggilan': p.nickname || '',
          'Tangan': p.handedness || 'Kanan',
          'Level': p.level || 'Intermediate',
          'Slogan Juara': p.slogan_text || '',
          'Total Main': played,
          'Menang': won,
          'Kalah': p.matches_lost || 0,
          'Win Rate (%)': winRate
        };
      });
      const wsPlayers = XLSX.utils.json_to_sheet(
        playerRows.length > 0 ? playerRows : [{ 'Info': 'Belum ada data pemain' }]
      );
      XLSX.utils.book_append_sheet(wb, wsPlayers, 'Klasemen_Pemain');

      // Sheet 3: Turnamen
      const tourneyRows = (AppState.tournaments || []).map(t => ({
        'ID Turnamen': t.id || '',
        'Nama Turnamen': t.name || '',
        'Olahraga': (t.sport || 'padel').toUpperCase(),
        'Format': (t.format || 'knockout').toUpperCase(),
        'Jumlah Peserta': (t.participants || []).length,
        'Status': t.status || 'active',
        'Juara': t.champion_name || 'Belum Selesai',
        'Dibuat Pada': t.created_at || ''
      }));
      const wsTourneys = XLSX.utils.json_to_sheet(
        tourneyRows.length > 0 ? tourneyRows : [{ 'Info': 'Belum ada data turnamen' }]
      );
      XLSX.utils.book_append_sheet(wb, wsTourneys, 'Turnamen');

      XLSX.writeFile(wb, 'DF_Scoring_Laporan.xlsx');
      showToast('Laporan Excel (.xlsx) berhasil diunduh!');
      return;
    } catch (err) {
      console.warn('XLSX export fallback:', err);
    }
  }
  window.location.href = '/api/export/excel';
}

function renderAll() {
  updateScoreboardUI();
}
