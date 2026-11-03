/**
 * Tennis & Padel Rules & Scoring Engine
 * Supports standard tennis (Deuce & Advantage), padel golden-point (punto de oro),
 * doubles (4 players with rotating service), mini-games (1 to 10+ games),
 * tiebreaks, super tiebreak, full undo/redo, and side change alerts.
 */

class MatchScorer {
  constructor(config = {}) {
    this.init(config);
  }

  init(config = {}) {
    this.sport = config.sport || 'padel'; // 'padel' or 'tennis'
    this.mode = config.mode || 'singles'; // 'singles' or 'doubles'
    this.id = config.id || null;
    this.tournament_id = config.tournament_id || null;
    this.tournament_match_id = config.tournament_match_id || null;
    this.tournament_name = config.tournament_name || '';

    // Team A
    this.team_a = {
      name: config.team_a_name || 'Tim A',
      players: config.team_a_players || [], // [{ id, name, photo_url }, ...]
      photo: config.team_a_photo || ''
    };

    // Team B
    this.team_b = {
      name: config.team_b_name || 'Tim B',
      players: config.team_b_players || [], // [{ id, name, photo_url }, ...]
      photo: config.team_b_photo || ''
    };

    // If doubles and player objects are passed, ensure players array has 2 slots if possible
    if (this.mode === 'doubles') {
      if (!this.team_a.players || this.team_a.players.length === 0) {
        this.team_a.players = [
          { name: 'Pemain A1', photo_url: '' },
          { name: 'Pemain A2', photo_url: '' }
        ];
      }
      if (!this.team_b.players || this.team_b.players.length === 0) {
        this.team_b.players = [
          { name: 'Pemain B1', photo_url: '' },
          { name: 'Pemain B2', photo_url: '' }
        ];
      }
    }

    const defaultGames = config.rules?.games_per_set ?? (this.sport === 'padel' ? 6 : 6);

    this.rules = {
      sets_to_win: config.rules?.sets_to_win ?? 2,          // best of 3 (needs 2 sets to win)
      games_per_set: defaultGames,                          // e.g. 1 (mini), 3, 4, 6, 8, etc.
      golden_point: config.rules?.golden_point ?? false,    // default false so Deuce is standard!
      tiebreak_at: config.rules?.tiebreak_at ?? defaultGames, // tiebreak at target games (e.g. 6-6 or 3-3)
      tiebreak_points: config.rules?.tiebreak_points ?? 7,  // 7 pt tiebreak
      final_set_super_tiebreak: config.rules?.final_set_super_tiebreak ?? false
    };

    // Live match state
    this.sets_history = []; // [{ team_a: 6, team_b: 4, tiebreak_a: 7, tiebreak_b: 5, winner: 'team_a' }, ...]
    this.current_set_games = { team_a: 0, team_b: 0 };
    this.current_points = { team_a: 0, team_b: 0 }; // 0=0, 1=15, 2=30, 3=40, 4=AD
    this.tiebreak_points = { team_a: 0, team_b: 0 };

    this.is_tiebreak = false;
    this.is_super_tiebreak = false;
    
    // Server tracking: team and individual player index for doubles
    this.server = config.initial_server || 'team_a'; // 'team_a' or 'team_b'
    this.server_start_of_game = this.server;
    this.server_player_index = { team_a: 0, team_b: 0 }; // 0 or 1 for doubles
    
    this.winner = config.winner || null;
    this.is_completed = config.is_completed || false;
    this.win_type = config.win_type || null;     // 'walkover' | 'disqualification' | 'retired'
    this.win_reason = config.win_reason || '';   // e.g. 'Lawan Diskualifikasi (DQ)'
    this.court_id = config.court_id || 'court_1'; // Lapangan 1 or Lapangan 2
    this.start_time = new Date();
    this.end_time = null;
    this.duration_minutes = 0;

    // History stack for Undo/Redo
    this.history = [];
    this.redoStack = [];

    // Notifications
    this.side_switch_alert = false;
  }

  // Clone current snapshot
  getSnapshot() {
    return {
      sets_history: JSON.parse(JSON.stringify(this.sets_history)),
      current_set_games: { ...this.current_set_games },
      current_points: { ...this.current_points },
      tiebreak_points: { ...this.tiebreak_points },
      is_tiebreak: this.is_tiebreak,
      is_super_tiebreak: this.is_super_tiebreak,
      server: this.server,
      server_start_of_game: this.server_start_of_game,
      server_player_index: { ...this.server_player_index },
      rules: { ...this.rules },
      winner: this.winner,
      is_completed: this.is_completed,
      win_type: this.win_type,
      win_reason: this.win_reason,
      court_id: this.court_id,
      side_switch_alert: this.side_switch_alert
    };
  }

  restoreSnapshot(snap) {
    this.sets_history = JSON.parse(JSON.stringify(snap.sets_history));
    this.current_set_games = { ...snap.current_set_games };
    this.current_points = { ...snap.current_points };
    this.tiebreak_points = { ...snap.tiebreak_points };
    this.is_tiebreak = snap.is_tiebreak;
    this.is_super_tiebreak = snap.is_super_tiebreak;
    this.server = snap.server;
    this.server_start_of_game = snap.server_start_of_game;
    this.server_player_index = { ...(snap.server_player_index || { team_a: 0, team_b: 0 }) };
    if (snap.rules) this.rules = { ...snap.rules };
    this.winner = snap.winner;
    this.is_completed = snap.is_completed;
    this.win_type = snap.win_type || null;
    this.win_reason = snap.win_reason || '';
    this.court_id = snap.court_id || 'court_1';
    this.side_switch_alert = snap.side_switch_alert;
  }

  pushHistory() {
    this.history.push(this.getSnapshot());
    if (this.history.length > 50) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.history.length === 0) return false;
    this.redoStack.push(this.getSnapshot());
    const prev = this.history.pop();
    this.restoreSnapshot(prev);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.history.push(this.getSnapshot());
    const next = this.redoStack.pop();
    this.restoreSnapshot(next);
    return true;
  }

  // Toggle serving team or individual server in doubles
  toggleServer() {
    this.pushHistory();
    if (this.mode === 'doubles') {
      // In doubles, rotate server among the 4 players: A1 -> B1 -> A2 -> B2
      if (this.server === 'team_a') {
        this.server = 'team_b';
      } else {
        this.server = 'team_a';
        this.server_player_index.team_a = this.server_player_index.team_a === 0 ? 1 : 0;
        this.server_player_index.team_b = this.server_player_index.team_b === 0 ? 1 : 0;
      }
    } else {
      this.server = this.server === 'team_a' ? 'team_b' : 'team_a';
    }
    this.server_start_of_game = this.server;
  }

  // Set explicit server player in doubles
  setDoublesServer(team, playerIndex) {
    this.pushHistory();
    this.server = team;
    this.server_start_of_game = team;
    this.server_player_index[team] = playerIndex;
  }

  // Quick DEUCE button (40-40)
  setDeuce() {
    if (this.is_completed) return;
    this.pushHistory();
    this.is_tiebreak = false;
    this.current_points = { team_a: 3, team_b: 3 }; // 40 - 40
    window.soundEngine?.playPointBeep();
    window.soundEngine?.speak("Deuce!");
  }

  // Toggle Golden Point on the fly
  toggleGoldenPoint() {
    this.pushHistory();
    this.rules.golden_point = !this.rules.golden_point;
    // If currently at Advantage (4) and switching to Golden Point, drop back to 40 (3)
    if (this.rules.golden_point) {
      if (this.current_points.team_a === 4) this.current_points.team_a = 3;
      if (this.current_points.team_b === 4) this.current_points.team_b = 3;
    }
    return this.rules.golden_point;
  }

  // Update target games per set on the fly (for mini-games)
  setTargetGames(num) {
    const val = parseInt(num) || 6;
    this.pushHistory();
    this.rules.games_per_set = val;
    this.rules.tiebreak_at = val;
  }

  // --- Add Point ---
  addPoint(team) {
    if (this.is_completed) return;
    this.pushHistory();
    this.side_switch_alert = false;

    window.soundEngine?.playPointBeep();

    const otherTeam = team === 'team_a' ? 'team_b' : 'team_a';

    if (this.is_tiebreak || this.is_super_tiebreak) {
      this.handleTiebreakPoint(team, otherTeam);
    } else {
      this.handleRegularPoint(team, otherTeam);
    }
  }

  handleRegularPoint(team, otherTeam) {
    const ptTeam = this.current_points[team];
    const ptOther = this.current_points[otherTeam];

    // 1. Check Golden Point (No-Ad at 40-40)
    if (this.rules.golden_point && ptTeam === 3 && ptOther === 3) {
      // Punto de oro: next point directly wins the game!
      this.winGame(team);
      return;
    }

    // 2. Standard Tennis / Advantage scoring
    if (ptTeam === 3 && ptOther < 3) {
      // 40-0, 40-15, 40-30 -> Game
      this.winGame(team);
    } else if (ptTeam < 3 && ptOther === 3) {
      // Team advancing to 40-30, 40-15...
      this.current_points[team]++;
      this.announceCurrentScore();
    } else if (ptTeam === 3 && ptOther === 3) {
      // 40-40 (DEUCE) -> Team gains ADVANTAGE (pt = 4)
      this.current_points[team] = 4;
      this.announceCurrentScore();
    } else if (ptTeam === 4) {
      // Advantage -> Game!
      this.winGame(team);
    } else if (ptOther === 4) {
      // Opponent had Advantage -> back to DEUCE (3 - 3)!
      this.current_points[otherTeam] = 3;
      this.announceCurrentScore();
    } else {
      // 0->15->30->40
      this.current_points[team]++;
      this.announceCurrentScore();
    }
  }

  handleTiebreakPoint(team, otherTeam) {
    this.tiebreak_points[team]++;
    const target = this.is_super_tiebreak ? 10 : (this.rules.tiebreak_points || 7);
    const scoreA = this.tiebreak_points.team_a;
    const scoreB = this.tiebreak_points.team_b;
    const totalPts = scoreA + scoreB;

    // Service rotation in tiebreak: ABBA (first point by initial server, then every 2 points it rotates)
    if (totalPts % 2 === 1) {
      this.server = this.server === 'team_a' ? 'team_b' : 'team_a';
      if (this.mode === 'doubles') {
        this.server_player_index[this.server] = this.server_player_index[this.server] === 0 ? 1 : 0;
      }
    }

    // Side change reminder every 6 points in tiebreak
    if (totalPts % 6 === 0) {
      this.side_switch_alert = true;
      window.soundEngine?.announceSideSwitch();
    }

    // Check tiebreak win condition (at least target points and 2-point lead)
    const ptsTeam = this.tiebreak_points[team];
    const ptsOther = this.tiebreak_points[otherTeam];

    if (ptsTeam >= target && (ptsTeam - ptsOther) >= 2) {
      // Won tiebreak!
      this.current_set_games[team]++;
      this.winSet(team, true);
    } else {
      window.soundEngine?.announceScore(
        scoreA,
        scoreB,
        this.server === 'team_a',
        this.team_a.name,
        this.team_b.name,
        true,
        false
      );
    }
  }

  winGame(team) {
    this.current_points = { team_a: 0, team_b: 0 };
    this.current_set_games[team]++;

    const teamWinnerName = team === 'team_a' ? this.team_a.name : this.team_b.name;
    const gamesA = this.current_set_games.team_a;
    const gamesB = this.current_set_games.team_b;
    const targetGames = this.rules.games_per_set;

    // Rotate regular server for next game
    if (this.mode === 'doubles') {
      if (this.server_start_of_game === 'team_a') {
        this.server_start_of_game = 'team_b';
      } else {
        this.server_start_of_game = 'team_a';
        // Toggle individual server index for next rotation
        this.server_player_index.team_a = this.server_player_index.team_a === 0 ? 1 : 0;
        this.server_player_index.team_b = this.server_player_index.team_b === 0 ? 1 : 0;
      }
    } else {
      this.server_start_of_game = this.server_start_of_game === 'team_a' ? 'team_b' : 'team_a';
    }
    this.server = this.server_start_of_game;

    // Side switch reminder: odd number of total games in set (1, 3, 5, 7...)
    const totalGames = gamesA + gamesB;
    if (totalGames % 2 === 1) {
      this.side_switch_alert = true;
    }

    // --- CHECK MINI-GAME OR FULL SET WIN ---
    const gamesWinner = this.current_set_games[team];
    const gamesLoser = this.current_set_games[team === 'team_a' ? 'team_b' : 'team_a'];

    // 1. Mini Game (1 game per set)
    if (targetGames === 1 && gamesWinner >= 1) {
      this.winSet(team, false);
      return;
    }

    // 2. Standard or Custom games per set (e.g. 2, 3, 4, 6, 8)
    // Lead by 2 when reaching target (e.g. 6-4, 6-3, 3-1, 4-2)
    if (gamesWinner >= targetGames && (gamesWinner - gamesLoser) >= 2) {
      this.winSet(team, false);
      return;
    }

    // 3. Pro set or advantage set reaching target+1 (e.g. 7-5 if target was 6)
    if (gamesWinner === targetGames + 1 && gamesLoser === targetGames - 1) {
      this.winSet(team, false);
      return;
    }

    // 4. Tiebreak trigger: both teams reached tiebreak_at (e.g. 6-6, 3-3, 4-4)
    if (gamesA === this.rules.tiebreak_at && gamesB === this.rules.tiebreak_at) {
      this.is_tiebreak = true;
      this.tiebreak_points = { team_a: 0, team_b: 0 };
      window.soundEngine?.announceGame(teamWinnerName, gamesA, gamesB);
      setTimeout(() => {
        window.soundEngine?.speak(window.soundEngine.voiceLang === 'id-ID' ? "Memasuki Tie-break!" : "Entering Tie-break!");
      }, 1200);
      return;
    }

    window.soundEngine?.announceGame(teamWinnerName, gamesA, gamesB);
    if (this.side_switch_alert) {
      setTimeout(() => window.soundEngine?.announceSideSwitch(), 1200);
    }
  }

  winSet(team, wasTiebreak = false) {
    const winnerName = team === 'team_a' ? this.team_a.name : this.team_b.name;
    
    // Record to history
    const setRecord = {
      team_a: this.current_set_games.team_a,
      team_b: this.current_set_games.team_b,
      tiebreak_a: wasTiebreak ? this.tiebreak_points.team_a : null,
      tiebreak_b: wasTiebreak ? this.tiebreak_points.team_b : null,
      winner: team
    };
    this.sets_history.push(setRecord);

    // Reset games & tiebreak
    this.current_set_games = { team_a: 0, team_b: 0 };
    this.current_points = { team_a: 0, team_b: 0 };
    this.tiebreak_points = { team_a: 0, team_b: 0 };
    this.is_tiebreak = false;

    // Count sets won
    const setsWonA = this.sets_history.filter(s => s.winner === 'team_a').length;
    const setsWonB = this.sets_history.filter(s => s.winner === 'team_b').length;

    // Check match win
    const setsNeeded = this.rules.sets_to_win;
    if (setsWonA >= setsNeeded) {
      this.finishMatch('team_a');
      return;
    } else if (setsWonB >= setsNeeded) {
      this.finishMatch('team_b');
      return;
    }

    // Check deciding final set super tiebreak rule
    const currentSetIndex = this.sets_history.length + 1;
    const totalSetsBestOf = setsNeeded * 2 - 1;
    if (this.rules.final_set_super_tiebreak && currentSetIndex === totalSetsBestOf) {
      this.is_super_tiebreak = true;
      this.is_tiebreak = true;
    }

    window.soundEngine?.announceSet(winnerName, this.sets_history.length, setsWonA, setsWonB);
  }

  finishMatch(winner) {
    this.winner = winner;
    this.is_completed = true;
    this.end_time = new Date();
    this.duration_minutes = Math.max(1, Math.round((this.end_time - this.start_time) / 60000));

    const winnerName = winner === 'team_a' ? this.team_a.name : this.team_b.name;
    window.soundEngine?.announceMatch(winnerName);
  }

  // Win by Walkover (W.O.), Disqualification (DQ), or Retirement (RET)
  winByDefault(winnerTeam, reasonType = 'walkover', customNote = '') {
    this.pushHistory();
    this.winner = winnerTeam;
    this.is_completed = true;
    this.win_type = reasonType;
    
    let defaultReason = 'Walkover (W.O.)';
    if (reasonType === 'disqualification') defaultReason = 'Diskualifikasi (DQ)';
    else if (reasonType === 'retired') defaultReason = 'Mundur / Cedera (RET)';
    else if (reasonType === 'walkover') defaultReason = 'Tidak Hadir / Walkover (W.O.)';

    this.win_reason = customNote || defaultReason;
    this.end_time = new Date();
    this.duration_minutes = Math.max(1, Math.round((this.end_time - this.start_time) / 60000));

    // If sets history is empty or match was in progress, record special set badge
    const winLabel = winnerTeam === 'team_a' ? 'W' : 'Gugur';
    const loseLabel = winnerTeam === 'team_b' ? 'W' : 'Gugur';
    
    if (this.sets_history.length === 0) {
      this.sets_history.push({
        team_a: winLabel,
        team_b: loseLabel,
        winner: winnerTeam,
        note: this.win_reason
      });
    } else {
      // Append current unfinished set note
      this.sets_history.push({
        team_a: `${this.current_set_games.team_a} (${winLabel})`,
        team_b: `${this.current_set_games.team_b} (${loseLabel})`,
        winner: winnerTeam,
        note: this.win_reason
      });
    }

    const winnerName = winnerTeam === 'team_a' ? this.team_a.name : this.team_b.name;
    window.soundEngine?.announceWalkoverWin(winnerName, this.win_reason);
  }

  announceCurrentScore() {
    const isGold = this.isGoldenPoint();
    window.soundEngine?.announceScore(
      this.getDisplayPoint('team_a'),
      this.getDisplayPoint('team_b'),
      this.server === 'team_a',
      this.team_a.name,
      this.team_b.name,
      this.is_tiebreak || this.is_super_tiebreak,
      isGold
    );
  }

  getDisplayPoint(team) {
    if (this.is_tiebreak || this.is_super_tiebreak) {
      return this.tiebreak_points[team].toString();
    }
    const pt = this.current_points[team];
    if (pt === 0) return '0';
    if (pt === 1) return '15';
    if (pt === 2) return '30';
    if (pt === 3) return '40';
    if (pt === 4) return 'AD';
    return '0';
  }

  isGoldenPoint() {
    return this.rules.golden_point &&
      !this.is_tiebreak &&
      this.current_points.team_a === 3 &&
      this.current_points.team_b === 3;
  }

  isDeuce() {
    return !this.rules.golden_point &&
      !this.is_tiebreak &&
      this.current_points.team_a === 3 &&
      this.current_points.team_b === 3;
  }

  hasAdvantage() {
    return !this.rules.golden_point &&
      !this.is_tiebreak &&
      (this.current_points.team_a === 4 || this.current_points.team_b === 4);
  }

  getAdvantageTeam() {
    if (this.current_points.team_a === 4) return 'team_a';
    if (this.current_points.team_b === 4) return 'team_b';
    return null;
  }

  getSetsWon(team) {
    return this.sets_history.filter(s => s.winner === team).length;
  }

  // Get active server player object (for doubles)
  getActiveServerPlayer() {
    const team = this.server;
    const teamObj = team === 'team_a' ? this.team_a : this.team_b;
    if (this.mode === 'doubles' && teamObj.players && teamObj.players.length > 0) {
      const idx = this.server_player_index[team] % teamObj.players.length;
      return teamObj.players[idx];
    }
    return teamObj.players?.[0] || { name: teamObj.name };
  }

  toJSON() {
    return {
      id: this.id,
      tournament_id: this.tournament_id,
      tournament_match_id: this.tournament_match_id,
      tournament_name: this.tournament_name,
      court_id: this.court_id || 'court_1',
      date: new Date().toISOString().replace('T', ' ').substring(0, 19),
      name: `${this.team_a.name} vs ${this.team_b.name}`,
      sport: this.sport,
      mode: this.mode,
      team_a_name: this.team_a.name,
      team_b_name: this.team_b.name,
      team_a_player_ids: this.team_a.players.map(p => p.id || p.name || 'player_a'),
      team_b_player_ids: this.team_b.players.map(p => p.id || p.name || 'player_b'),
      team_a_players: this.team_a.players,
      team_b_players: this.team_b.players,
      rules: this.rules,
      sets_history: this.sets_history,
      winner: this.winner,
      win_type: this.win_type || null,
      win_reason: this.win_reason || '',
      status: this.is_completed ? 'completed' : 'in_progress',
      duration_minutes: this.duration_minutes || 1
    };
  }
}

window.MatchScorer = MatchScorer;
