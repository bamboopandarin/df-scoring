/**
 * Tennis & Padel Rules & Scoring Engine PRO
 * Supports standard tennis (Deuce & Advantage), padel golden-point (punto de oro),
 * doubles (4 players with rotating service), mini-games (1 to 10+ games),
 * tiebreaks, super tiebreak, full undo/redo, rich point-by-point statistics,
 * lossless JSON serialization (toJSON / toLightJSON / fromJSON), and side change alerts.
 */

class MatchScorer {
  constructor(config = {}) {
    this.init(config);
  }

  init(config = {}) {
    this.sport = config.sport || 'padel'; // 'padel' or 'tennis'
    this.mode = config.mode || 'doubles'; // 'singles' or 'doubles'
    this.id = config.id || ('m_' + Math.random().toString(36).substring(2, 10));
    this.tournament_id = config.tournament_id || null;
    this.tournament_match_id = config.tournament_match_id || null;
    this.tournament_name = config.tournament_name || '';
    this.version = config.version || 1;
    this.scored_by = config.scored_by || null; // { name, email, role }

    const teamAObj = config.team_a || {};
    const teamBObj = config.team_b || {};

    // Team A
    this.team_a = {
      name: config.team_a_name || teamAObj.name || 'Tim A',
      players: config.team_a_players || teamAObj.players || [],
      photo: config.team_a_photo || teamAObj.photo || ''
    };

    // Team B
    this.team_b = {
      name: config.team_b_name || teamBObj.name || 'Tim B',
      players: config.team_b_players || teamBObj.players || [],
      photo: config.team_b_photo || teamBObj.photo || ''
    };

    // Ensure players array has 2 slots in doubles mode
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
    } else {
      if (!this.team_a.players || this.team_a.players.length === 0) {
        this.team_a.players = [{ name: this.team_a.name, photo_url: this.team_a.photo || '' }];
      }
      if (!this.team_b.players || this.team_b.players.length === 0) {
        this.team_b.players = [{ name: this.team_b.name, photo_url: this.team_b.photo || '' }];
      }
    }

    const defaultGames = config.rules?.games_per_set ?? 6;

    this.rules = {
      sets_to_win: config.rules?.sets_to_win ?? 2,
      games_per_set: defaultGames,
      golden_point: config.rules?.golden_point ?? false,
      tiebreak_at: config.rules?.tiebreak_at ?? defaultGames,
      tiebreak_points: config.rules?.tiebreak_points ?? 7,
      final_set_super_tiebreak: config.rules?.final_set_super_tiebreak ?? false
    };

    // Live match state
    this.sets_history = Array.isArray(config.sets_history) ? JSON.parse(JSON.stringify(config.sets_history)) : [];
    this.current_set_games = config.current_set_games ? { ...config.current_set_games } : { team_a: 0, team_b: 0 };
    this.current_points = config.current_points ? { ...config.current_points } : { team_a: 0, team_b: 0 };
    this.tiebreak_points = config.tiebreak_points ? { ...config.tiebreak_points } : { team_a: 0, team_b: 0 };

    this.is_tiebreak = !!config.is_tiebreak;
    this.is_super_tiebreak = !!config.is_super_tiebreak;

    // Server tracking: team and individual player index for doubles
    this.server = config.server || config.initial_server || 'team_a';
    this.server_start_of_game = config.server_start_of_game || this.server;
    this.server_player_index = config.server_player_index
      ? { ...config.server_player_index }
      : { team_a: 0, team_b: 0 };

    this.winner = config.winner || null;
    this.is_completed = !!(config.is_completed || config.status === 'completed');
    this.win_type = config.win_type || null; // 'walkover' | 'disqualification' | 'retired'
    this.win_reason = config.win_reason || '';
    this.court_id = config.court_id || 'court_1';
    this.start_time = config.start_time ? new Date(config.start_time) : new Date();
    this.end_time = config.end_time ? new Date(config.end_time) : null;
    this.duration_minutes = config.duration_minutes || 0;
    this.duration_seconds = config.duration_seconds || 0;

    // Detailed Match Analytics
    this.stats = config.stats ? { ...config.stats } : {
      total_points_a: 0,
      total_points_b: 0,
      deuces_count: 0,
      golden_points_count: 0,
      service_games_won_a: 0,
      service_games_won_b: 0,
      breaks_won_a: 0,
      breaks_won_b: 0,
      max_streak_a: 0,
      max_streak_b: 0,
      current_streak_a: 0,
      current_streak_b: 0
    };

    this.point_log = Array.isArray(config.point_log) ? [...config.point_log] : [];

    // History stack for Undo/Redo
    this.undo_count = config.undo_count || 0;
    this.redo_count = config.redo_count || 0;
    this.history = config.history || [];
    this.redoStack = config.redoStack || [];

    // Notifications
    this.side_switch_alert = !!config.side_switch_alert;
  }

  static fromJSON(data = {}) {
    if (!data || typeof data !== 'object') {
      return new MatchScorer();
    }
    return new MatchScorer(data);
  }

  // Clone current snapshot for Undo/Redo
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
      start_time: this.start_time.toISOString(),
      end_time: this.end_time?.toISOString() || null,
      side_switch_alert: this.side_switch_alert,
      stats: { ...this.stats },
      point_log: JSON.parse(JSON.stringify(this.point_log))
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
    if (snap.start_time) this.start_time = new Date(snap.start_time);
    this.end_time = snap.end_time ? new Date(snap.end_time) : null;
    this.side_switch_alert = snap.side_switch_alert;
    if (snap.stats) this.stats = { ...snap.stats };
    if (snap.point_log) this.point_log = JSON.parse(JSON.stringify(snap.point_log));
    this.version++;
  }

  pushHistory() {
    this.history.push(this.getSnapshot());
    if (this.history.length > 30) this.history.shift();
    this.redoStack = [];
    this.version++;
  }

  undo() {
    if (this.history.length === 0) return false;
    this.redoStack.push(this.getSnapshot());
    const prev = this.history.pop();
    this.restoreSnapshot(prev);
    globalThis.soundEngine?.playUndoBeep();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.history.push(this.getSnapshot());
    const next = this.redoStack.pop();
    this.restoreSnapshot(next);
    globalThis.soundEngine?.playPointBeep();
    return true;
  }

  resetMatch() {
    this.pushHistory();
    this.sets_history = [];
    this.current_set_games = { team_a: 0, team_b: 0 };
    this.current_points = { team_a: 0, team_b: 0 };
    this.tiebreak_points = { team_a: 0, team_b: 0 };
    this.is_tiebreak = false;
    this.is_super_tiebreak = false;
    this.winner = null;
    this.is_completed = false;
    this.win_type = null;
    this.win_reason = '';
    this.side_switch_alert = false;
    this.start_time = new Date();
    this.end_time = null;
    this.duration_minutes = 0;
    this.duration_seconds = 0;
    this.stats = {
      total_points_a: 0,
      total_points_b: 0,
      deuces_count: 0,
      golden_points_count: 0,
      service_games_won_a: 0,
      service_games_won_b: 0,
      breaks_won_a: 0,
      breaks_won_b: 0,
      max_streak_a: 0,
      max_streak_b: 0,
      current_streak_a: 0,
      current_streak_b: 0
    };
    this.point_log = [];
  }

  // Toggle serving team or individual server in doubles
  toggleServer() {
    this.pushHistory();
    if (this.mode === 'doubles') {
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

  applyAction(action) {
    const { type, team, player, games, reason, note } = action || {};
    if (type === 'undo') return this.undo();
    if (type === 'redo') return this.redo();
    if (this.is_completed) return false;

    const validTeam = team === 'team_a' || team === 'team_b';
    if (type === 'point' && validTeam) this.addPoint(team);
    else if (type === 'server') this.toggleServer();
    else if (type === 'doubles_server' && this.mode === 'doubles' && validTeam && [0, 1].includes(player)) {
      this.setDoublesServer(team, player);
    } else if (type === 'golden_point') this.toggleGoldenPoint();
    else if (type === 'target' && Number.isInteger(games) && games >= 1 && games <= 50) this.setTargetGames(games);
    else if (type === 'reset') this.resetMatch();
    else if (type === 'walkover' && validTeam && ['walkover', 'disqualification', 'retired'].includes(reason)) {
      this.winByDefault(team, reason, String(note || '').slice(0, 200));
    } else return false;
    return true;
  }

  finishEarly(winner) {
    if (winner !== 'team_a' && winner !== 'team_b') return false;
    this.winner = winner;
    this.is_completed = true;
    this.win_reason = 'Diselesaikan manual';
    this.end_time = new Date();
    const { team_a, team_b } = this.current_set_games;
    if (team_a || team_b) this.sets_history.push({ team_a, team_b, partial: true });
    return true;
  }

  // Toggle Golden Point on the fly
  toggleGoldenPoint() {
    this.pushHistory();
    this.rules.golden_point = !this.rules.golden_point;
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

    globalThis.soundEngine?.playPointBeep();

    // Update Point & Streak Analytics
    if (team === 'team_a') {
      this.stats.total_points_a = (this.stats.total_points_a || 0) + 1;
      this.stats.current_streak_a = (this.stats.current_streak_a || 0) + 1;
      this.stats.current_streak_b = 0;
      if (this.stats.current_streak_a > (this.stats.max_streak_a || 0)) {
        this.stats.max_streak_a = this.stats.current_streak_a;
      }
    } else {
      this.stats.total_points_b = (this.stats.total_points_b || 0) + 1;
      this.stats.current_streak_b = (this.stats.current_streak_b || 0) + 1;
      this.stats.current_streak_a = 0;
      if (this.stats.current_streak_b > (this.stats.max_streak_b || 0)) {
        this.stats.max_streak_b = this.stats.current_streak_b;
      }
    }

    const otherTeam = team === 'team_a' ? 'team_b' : 'team_a';

    if (this.is_tiebreak || this.is_super_tiebreak) {
      this.handleTiebreakPoint(team, otherTeam);
    } else {
      this.handleRegularPoint(team, otherTeam);
    }

    // Record to point log (keep last 80 points for timeline analysis)
    this.point_log.push({
      t: new Date().toISOString().substring(11, 19),
      team,
      pt_a: this.getDisplayPoint('team_a'),
      pt_b: this.getDisplayPoint('team_b'),
      gm_a: this.current_set_games.team_a,
      gm_b: this.current_set_games.team_b,
      set_a: this.getSetsWon('team_a'),
      set_b: this.getSetsWon('team_b')
    });
    if (this.point_log.length > 80) {
      this.point_log.shift();
    }
  }

  handleRegularPoint(team, otherTeam) {
    const ptTeam = this.current_points[team];
    const ptOther = this.current_points[otherTeam];

    // 1. Check Golden Point (No-Ad at 40-40)
    if (this.rules.golden_point && ptTeam === 3 && ptOther === 3) {
      this.winGame(team);
      return;
    }

    // 2. Standard Tennis / Advantage scoring
    if (ptTeam === 3 && ptOther < 3) {
      this.winGame(team);
    } else if (ptTeam < 3 && ptOther === 3) {
      this.current_points[team]++;
      if (this.current_points.team_a === 3 && this.current_points.team_b === 3) {
        if (this.rules.golden_point) {
          this.stats.golden_points_count = (this.stats.golden_points_count || 0) + 1;
        } else {
          this.stats.deuces_count = (this.stats.deuces_count || 0) + 1;
        }
      }
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
      this.stats.deuces_count = (this.stats.deuces_count || 0) + 1;
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

    // Service rotation in tiebreak: ABBA
    if (totalPts % 2 === 1) {
      this.server = this.server === 'team_a' ? 'team_b' : 'team_a';
      if (this.mode === 'doubles') {
        this.server_player_index[this.server] = this.server_player_index[this.server] === 0 ? 1 : 0;
      }
    }

    // Side change reminder every 6 points in tiebreak
    if (totalPts % 6 === 0) {
      this.side_switch_alert = true;
      globalThis.soundEngine?.announceSideSwitch();
    }

    const ptsTeam = this.tiebreak_points[team];
    const ptsOther = this.tiebreak_points[otherTeam];

    if (ptsTeam >= target && (ptsTeam - ptsOther) >= 2) {
      this.current_set_games[team]++;
      this.winSet(team, true);
    } else {
      globalThis.soundEngine?.announceScore(
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

    // Track service hold vs break of serve
    if (this.server === team) {
      if (team === 'team_a') this.stats.service_games_won_a = (this.stats.service_games_won_a || 0) + 1;
      else this.stats.service_games_won_b = (this.stats.service_games_won_b || 0) + 1;
    } else {
      if (team === 'team_a') this.stats.breaks_won_a = (this.stats.breaks_won_a || 0) + 1;
      else this.stats.breaks_won_b = (this.stats.breaks_won_b || 0) + 1;
    }

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

    // 2. Standard or Custom games per set (lead by 2 when reaching target)
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
      globalThis.soundEngine?.announceGame(teamWinnerName, gamesA, gamesB);
      setTimeout(() => {
        globalThis.soundEngine?.speak(globalThis.soundEngine.voiceLang === 'id-ID' ? 'Memasuki Tie-break!' : 'Entering Tie-break!');
      }, 900);
      return;
    }

    globalThis.soundEngine?.announceGame(teamWinnerName, gamesA, gamesB);
    if (this.side_switch_alert) {
      if (globalThis.soundEngine) setTimeout(() => globalThis.soundEngine.announceSideSwitch(), 950);
    }
  }

  winSet(team, wasTiebreak = false) {
    const winnerName = team === 'team_a' ? this.team_a.name : this.team_b.name;

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

    const setsWonA = this.sets_history.filter(s => s.winner === 'team_a').length;
    const setsWonB = this.sets_history.filter(s => s.winner === 'team_b').length;

    const setsNeeded = this.rules.sets_to_win;
    if (setsWonA >= setsNeeded) {
      this.finishMatch('team_a');
      return;
    } else if (setsWonB >= setsNeeded) {
      this.finishMatch('team_b');
      return;
    }

    const currentSetIndex = this.sets_history.length + 1;
    const totalSetsBestOf = setsNeeded * 2 - 1;
    if (this.rules.final_set_super_tiebreak && currentSetIndex === totalSetsBestOf) {
      this.is_super_tiebreak = true;
      this.is_tiebreak = true;
    }

    globalThis.soundEngine?.announceSet(winnerName, this.sets_history.length, setsWonA, setsWonB);
  }

  finishMatch(winner) {
    this.winner = winner;
    this.is_completed = true;
    this.end_time = new Date();
    this.duration_minutes = Math.max(1, Math.round((this.end_time - this.start_time) / 60000));

    const winnerName = winner === 'team_a' ? this.team_a.name : this.team_b.name;
    globalThis.soundEngine?.announceMatch(winnerName);
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
      this.sets_history.push({
        team_a: `${this.current_set_games.team_a} (${winLabel})`,
        team_b: `${this.current_set_games.team_b} (${loseLabel})`,
        winner: winnerTeam,
        note: this.win_reason
      });
    }

    const winnerName = winnerTeam === 'team_a' ? this.team_a.name : this.team_b.name;
    globalThis.soundEngine?.announceWalkoverWin(winnerName, this.win_reason);
  }

  announceCurrentScore() {
    const isGold = this.isGoldenPoint();
    globalThis.soundEngine?.announceScore(
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
      return (this.tiebreak_points[team] || 0).toString();
    }
    const pt = this.current_points[team] || 0;
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

  getActiveServerPlayer() {
    const team = this.server;
    const teamObj = team === 'team_a' ? this.team_a : this.team_b;
    if (this.mode === 'doubles' && teamObj.players && teamObj.players.length > 0) {
      const idx = (this.server_player_index[team] || 0) % teamObj.players.length;
      return teamObj.players[idx];
    }
    return teamObj.players?.[0] || { name: teamObj.name };
  }

  toJSON() {
    const setsWonA = this.getSetsWon('team_a');
    const setsWonB = this.getSetsWon('team_b');
    return {
      id: this.id,
      version: this.version,
      tournament_id: this.tournament_id,
      tournament_match_id: this.tournament_match_id,
      tournament_name: this.tournament_name,
      court_id: this.court_id || 'court_1',
      date: this.start_time.toISOString().replace('T', ' ').substring(0, 19),
      start_time: this.start_time.toISOString(),
      end_time: this.end_time?.toISOString() || null,
      updated_at_ms: Date.now(),
      name: `${this.team_a.name} vs ${this.team_b.name}`,
      sport: this.sport,
      mode: this.mode,
      team_a_name: this.team_a.name,
      team_b_name: this.team_b.name,
      team_a_photo: this.team_a.photo || '',
      team_b_photo: this.team_b.photo || '',
      team_a: this.team_a,
      team_b: this.team_b,
      team_a_player_ids: (this.team_a.players || []).map(p => p.id || p.name || 'player_a'),
      team_b_player_ids: (this.team_b.players || []).map(p => p.id || p.name || 'player_b'),
      team_a_players: this.team_a.players || [],
      team_b_players: this.team_b.players || [],
      rules: { ...this.rules },
      sets_history: this.sets_history,
      current_set_games: { ...this.current_set_games },
      current_points: { ...this.current_points },
      tiebreak_points: { ...this.tiebreak_points },
      is_tiebreak: this.is_tiebreak,
      is_super_tiebreak: this.is_super_tiebreak,
      server: this.server,
      server_start_of_game: this.server_start_of_game,
      server_player_index: { ...this.server_player_index },
      sets_won: { team_a: setsWonA, team_b: setsWonB },
      display_point_a: this.getDisplayPoint('team_a'),
      display_point_b: this.getDisplayPoint('team_b'),
      side_switch_alert: this.side_switch_alert,
      stats: { ...this.stats },
      point_log: this.point_log,
      scored_by: this.scored_by,
      winner: this.winner,
      is_completed: this.is_completed,
      win_type: this.win_type || null,
      win_reason: this.win_reason || '',
      status: this.is_completed ? 'completed' : 'in_progress',
      duration_minutes: this.duration_minutes || Math.max(1, Math.round((this.duration_seconds || 0) / 60)),
      duration_seconds: this.duration_seconds || 0
    };
  }

  // Lightweight JSON payload for real-time court sync (strips heavy base64 audio/images)
  toLightJSON() {
    const full = this.toJSON();
    const stripHeavy = (p) => {
      if (!p) return p;
      const copy = { ...p };
      if (copy.slogan_audio_url && copy.slogan_audio_url.startsWith('data:')) {
        copy.slogan_audio_url = '';
      }
      if (copy.photo_url && copy.photo_url.length > 4000) {
        copy.photo_url = '';
      }
      return copy;
    };
    full.team_a_players = (full.team_a_players || []).map(stripHeavy);
    full.team_b_players = (full.team_b_players || []).map(stripHeavy);
    if (full.team_a && full.team_a.players) {
      full.team_a = { ...full.team_a, players: full.team_a.players.map(stripHeavy) };
    }
    if (full.team_b && full.team_b.players) {
      full.team_b = { ...full.team_b, players: full.team_b.players.map(stripHeavy) };
    }
    if (full.team_a_photo && full.team_a_photo.length > 4000) full.team_a_photo = '';
    if (full.team_b_photo && full.team_b_photo.length > 4000) full.team_b_photo = '';
    return full;
  }
}

if (typeof window !== "undefined") window.MatchScorer = MatchScorer;

export { MatchScorer };
