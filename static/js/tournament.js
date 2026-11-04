/**
 * Tournament Engine for Padel & Tennis Master
 * Generates single-elimination brackets with visual tree, round-robin schedules,
 * supports both Singles and Doubles (2 players per team / 4 players per match),
 * automatic match progression, standings table, and champion crowns.
 */

class TournamentManager {
  constructor() {
    this.currentTournament = null;
  }

  // Generate single elimination bracket matches
  static createKnockoutTournament(name, sport, mode, participants, rules) {
    // participants is array of { id, name, photo_url, players?: [] }
    const count = participants.length;
    const bracketSize = 2 ** Math.ceil(Math.log2(count));
    const firstRoundSize = bracketSize / 2;

    // Number of rounds
    const totalRounds = Math.log2(bracketSize);
    const rounds = [];

    // Round 1
    const round1Matches = [];
    for (let i = 0; i < bracketSize / 2; i++) {
      const p1 = participants[i];
      const p2 = participants[i + firstRoundSize] || {
        id: 'BYE_' + i, name: 'BYE (Lolos Otomatis)', is_bye: true, players: []
      };

      const matchId = `r1_m${i + 1}`;
      const isByeMatch = p2.is_bye;

      round1Matches.push({
        id: matchId,
        round: 1,
        match_number: i + 1,
        team_a: p1,
        team_b: p2,
        winner: isByeMatch ? 'team_a' : null,
        winner_participant: isByeMatch ? p1 : null,
        status: isByeMatch ? 'completed' : 'pending',
        sets_history: isByeMatch ? [{ team_a: 'W', team_b: 'BYE' }] : [],
        score_display: isByeMatch ? 'BYE' : 'vs'
      });
    }
    rounds.push({ round_number: 1, name: this.getRoundName(1, totalRounds), matches: round1Matches });

    // Subsequent rounds
    for (let r = 2; r <= totalRounds; r++) {
      const matchesInRound = Math.pow(2, totalRounds - r);
      const roundMatches = [];
      const prevRound = rounds[r - 2];

      for (let m = 0; m < matchesInRound; m++) {
        // Feed from prev round m*2 and m*2+1
        const prevM1 = prevRound.matches[m * 2];
        const prevM2 = prevRound.matches[m * 2 + 1];

        const p1 = prevM1.winner_participant || null;
        const p2 = prevM2.winner_participant || null;

        roundMatches.push({
          id: `r${r}_m${m + 1}`,
          round: r,
          match_number: m + 1,
          team_a: p1,
          team_b: p2,
          winner: null,
          winner_participant: null,
          status: 'pending',
          sets_history: [],
          score_display: 'vs',
          feeds_from: [prevM1.id, prevM2.id]
        });
      }
      rounds.push({ round_number: r, name: this.getRoundName(r, totalRounds), matches: roundMatches });
    }

    return {
      id: 'tourn_' + Math.random().toString(36).substring(2, 9),
      name: name,
      sport: sport,
      mode: mode,
      format: 'knockout',
      total_rounds: totalRounds,
      bracket_size: bracketSize,
      participants: participants,
      rules: rules,
      rounds: rounds,
      status: 'active',
      champion: null,
      champion_name: null,
      created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
  }

  // Round Robin generator
  static createRoundRobinTournament(name, sport, mode, participants, rules) {
    let teams = [...participants];
    if (teams.length % 2 !== 0) {
      teams.push({ id: 'BYE', name: 'BYE', is_bye: true, players: [] });
    }

    const n = teams.length;
    const totalRounds = n - 1;
    const matchesPerRound = n / 2;
    const rounds = [];

    // Circle algorithm
    for (let r = 0; r < totalRounds; r++) {
      const roundMatches = [];
      for (let m = 0; m < matchesPerRound; m++) {
        const t1 = teams[m];
        const t2 = teams[n - 1 - m];

        if (!t1.is_bye && !t2.is_bye) {
          roundMatches.push({
            id: `rr_r${r + 1}_m${m + 1}`,
            round: r + 1,
            match_number: m + 1,
            team_a: t1,
            team_b: t2,
            winner: null,
            winner_participant: null,
            status: 'pending',
            sets_history: [],
            score_display: 'vs'
          });
        }
      }
      if (roundMatches.length > 0) {
        rounds.push({ round_number: r + 1, name: `Pekan / Putaran ${r + 1}`, matches: roundMatches });
      }

      // Rotate teams except first
      teams = [teams[0], teams[n - 1], ...teams.slice(1, n - 1)];
    }

    return {
      id: 'tourn_' + Math.random().toString(36).substring(2, 9),
      name: name,
      sport: sport,
      mode: mode,
      format: 'round_robin',
      participants: participants,
      rules: rules,
      rounds: rounds,
      status: 'active',
      champion: null,
      champion_name: null,
      created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
  }

  static getRoundName(round, totalRounds) {
    const diff = totalRounds - round;
    if (diff === 0) return '🏆 Final';
    if (diff === 1) return 'Semi Final';
    if (diff === 2) return 'Perempat Final (Quarter)';
    if (diff === 3) return 'Babak 16 Besar';
    return `Babak ${round}`;
  }

  // Update tournament match result & advance winner
  static recordMatchResult(tournament, matchId, matchData) {
    let matchFound = null;
    let matchRound = 0;

    for (const round of tournament.rounds) {
      for (const m of round.matches) {
        if (m.id === matchId) {
          matchFound = m;
          matchRound = round.round_number;
          break;
        }
      }
      if (matchFound) break;
    }

    if (!this.isPlayable(matchFound)) return false;

    matchFound.status = 'completed';
    matchFound.winner = matchData.winner; // 'team_a' or 'team_b'
    matchFound.winner_participant = matchData.winner === 'team_a' ? matchFound.team_a : matchFound.team_b;
    matchFound.sets_history = matchData.sets_history || [];
    matchFound.win_type = matchData.win_type || null;
    matchFound.win_reason = matchData.win_reason || '';

    // If won by disqualification or walkover, show clear note
    if (matchData.win_type && matchData.win_type !== "normal") {
      matchFound.score_display = matchData.win_reason || (matchData.win_type === 'disqualification' ? 'W.O. (Diskualifikasi)' : 'W.O.');
    } else if (matchData.sets_history && matchData.sets_history.length > 0) {
      matchFound.score_display = matchData.sets_history.map(s => `${s.team_a}-${s.team_b}`).join(', ');
    } else {
      matchFound.score_display = 'Selesai';
    }

    // If knockout, advance to next round
    if (tournament.format === 'knockout') {
      const nextRoundNum = matchRound + 1;
      const nextRound = tournament.rounds.find(r => r.round_number === nextRoundNum);

      if (nextRound) {
        const nextMatchIndex = Math.floor((matchFound.match_number - 1) / 2);
        const slot = (matchFound.match_number - 1) % 2 === 0 ? 'team_a' : 'team_b';
        if (nextRound.matches[nextMatchIndex]) {
          nextRound.matches[nextMatchIndex][slot] = matchFound.winner_participant;
        }
      } else {
        // This was the final!
        tournament.champion = matchFound.winner_participant;
        tournament.champion_name = matchFound.winner_participant?.name || 'Juara';
        tournament.status = 'completed';
      }
    } else if (tournament.rounds.every(round => round.matches.every(match => match.status === 'completed'))) {
      tournament.champion = this.calculateStandings(tournament)[0]?.participant || null;
      tournament.champion_name = tournament.champion?.name || null;
      tournament.status = 'completed';
    }

    return true;
  }

  static normalize(tournament) {
    if (Array.isArray(tournament.rounds)) return tournament;
    const rounds = tournament.bracket?.rounds || [{ round_number: 1, matches: tournament.schedule || [] }];
    return {
      ...tournament,
      rounds: rounds.map((round, index) => ({
        ...round,
        round_number: round.round_number || index + 1,
        matches: round.matches.map(match => ({
          ...match,
          team_a: match.team_a || match.player_a,
          team_b: match.team_b || match.player_b,
          winner: typeof match.winner === 'object' && match.winner
            ? (match.winner.id === (match.team_a || match.player_a)?.id ? 'team_a' : 'team_b')
            : match.winner,
          score_display: match.score_display || match.score_summary || 'vs'
        }))
      }))
    };
  }

  static findMatch(tournament, id) {
    return tournament?.rounds.flatMap(round => round.matches).find(match => match.id === id);
  }

  static isPlayable(match) {
    return Boolean(match?.team_a && match.team_b && !match.team_a.is_bye && !match.team_b.is_bye
      && match.status !== 'completed');
  }

  static hasResults(tournament) {
    return this.normalize(tournament).rounds.some(round => round.matches.some(match =>
      match.status === 'completed' && !match.team_a?.is_bye && !match.team_b?.is_bye));
  }

  // Record direct Walkover / Disqualification from bracket without starting match
  static recordWalkover(tournament, matchId, winnerTeamSlot, reasonType, customNote = '') {
    let matchFound = null;
    let matchRound = 0;

    for (const round of tournament.rounds) {
      for (const m of round.matches) {
        if (m.id === matchId) {
          matchFound = m;
          matchRound = round.round_number;
          break;
        }
      }
      if (matchFound) break;
    }

    if (!matchFound) return false;

    let reasonStr = customNote;
    if (!reasonStr) {
      if (reasonType === 'disqualification') reasonStr = 'W.O. (Diskualifikasi)';
      else if (reasonType === 'retired') reasonStr = 'Mundur / Cedera (RET)';
      else reasonStr = 'W.O. (Tidak Hadir)';
    }

    const winnerParticipant = winnerTeamSlot === 'team_a' ? matchFound.team_a : matchFound.team_b;
    const loserParticipant = winnerTeamSlot === 'team_a' ? matchFound.team_b : matchFound.team_a;

    const matchData = {
      winner: winnerTeamSlot,
      winner_participant: winnerParticipant,
      win_type: reasonType,
      win_reason: reasonStr,
      sets_history: [
        {
          team_a: winnerTeamSlot === 'team_a' ? 'W' : 'Gugur',
          team_b: winnerTeamSlot === 'team_b' ? 'W' : 'Gugur',
          winner: winnerTeamSlot,
          note: reasonStr
        }
      ]
    };

    return this.recordMatchResult(tournament, matchId, matchData);
  }

  // Swap first-round slots, then propagate automatic BYE results again.
  static swapRound1Participants(tournament, matchIdx1, slot1, matchIdx2, slot2) {
    if (this.hasResults(tournament)) {
      return { success: false, message: 'Bagan sudah memiliki hasil pertandingan.' };
    }
    const [firstRound, nextRound] = tournament.rounds;
    const m1 = firstRound.matches[matchIdx1];
    const m2 = firstRound.matches[matchIdx2];
    if (!m1?.[slot1] || !m2?.[slot2]) return { success: false, message: 'Slot tidak tersedia.' };

    [m1[slot1], m2[slot2]] = [m2[slot2], m1[slot1]];
    if ([m1, m2].some(match => match.team_a.is_bye && match.team_b.is_bye)) {
      [m1[slot1], m2[slot2]] = [m2[slot2], m1[slot1]];
      return { success: false, message: 'Satu pertandingan harus memiliki minimal satu peserta.' };
    }

    firstRound.matches.forEach((match, index) => {
      match.winner = match.team_a.is_bye ? 'team_b' : match.team_b.is_bye ? 'team_a' : null;
      match.winner_participant = match.winner ? match[match.winner] : null;
      match.status = match.winner ? 'completed' : 'pending';
      match.score_display = match.winner ? 'BYE' : 'vs';
      match.sets_history = [];
      if (nextRound) {
        const slot = index % 2 === 0 ? 'team_a' : 'team_b';
        nextRound.matches[Math.floor(index / 2)][slot] = match.winner_participant;
      }
    });
    return { success: true };
  }

  // Calculate Round Robin Standings
  static calculateStandings(tournament) {
    if (tournament.format !== 'round_robin') return [];

    const statsMap = Object.create(null);
    tournament.participants.forEach(p => {
      statsMap[p.id] = {
        participant: p,
        played: 0,
        won: 0,
        lost: 0,
        sets_won: 0,
        sets_lost: 0,
        games_won: 0,
        games_lost: 0,
        points: 0
      };
    });

    for (const round of tournament.rounds) {
      for (const m of round.matches) {
        if (m.status === 'completed' && m.sets_history) {
          const aId = m.team_a?.id;
          const bId = m.team_b?.id;
          if (!aId || !bId || !statsMap[aId] || !statsMap[bId]) continue;

          statsMap[aId].played++;
          statsMap[bId].played++;

          let setsA = 0;
          let setsB = 0;
          let gamesA = 0;
          let gamesB = 0;

          m.sets_history.forEach(s => {
            const gA = parseInt(s.team_a) || 0;
            const gB = parseInt(s.team_b) || 0;
            gamesA += gA;
            gamesB += gB;
            if (s.partial) return;
            if (s.winner === 'team_a' || gA > gB) setsA++;
            else if (s.winner === 'team_b' || gB > gA) setsB++;
          });

          statsMap[aId].sets_won += setsA;
          statsMap[aId].sets_lost += setsB;
          statsMap[bId].sets_won += setsB;
          statsMap[bId].sets_lost += setsA;

          statsMap[aId].games_won += gamesA;
          statsMap[aId].games_lost += gamesB;
          statsMap[bId].games_won += gamesB;
          statsMap[bId].games_lost += gamesA;

          if (m.winner === 'team_a') {
            statsMap[aId].won++;
            statsMap[aId].points += 3;
            statsMap[bId].lost++;
          } else if (m.winner === 'team_b') {
            statsMap[bId].won++;
            statsMap[bId].points += 3;
            statsMap[aId].lost++;
          }
        }
      }
    }

    const standings = Object.values(statsMap);
    standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const setDiffB = b.sets_won - b.sets_lost;
      const setDiffA = a.sets_won - a.sets_lost;
      if (setDiffB !== setDiffA) return setDiffB - setDiffA;
      const gameDiffB = b.games_won - b.games_lost;
      const gameDiffA = a.games_won - a.games_lost;
      return gameDiffB - gameDiffA;
    });

    return standings;
  }
}

if (typeof window !== "undefined") window.TournamentManager = TournamentManager;

export { TournamentManager };
