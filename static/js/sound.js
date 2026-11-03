/**
 * Sound Engine, Haptics & Voice Umpire for DF Scoring PRO
 * Uses Web Audio API for zero-latency sound effects, Navigator Vibrate for court haptics,
 * and non-blocking debounced Web Speech API for smooth referee announcements on mobile.
 */

class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
    this.hapticEnabled = localStorage.getItem('df_haptic_enabled') !== 'false';
    this.voiceLang = 'id-ID'; // 'id-ID' or 'en-US'
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    this.speakTimeout = null;
    this.currentAudio = null;

    if (this.synth) {
      const loadVoices = () => {
        try {
          this.voices = this.synth.getVoices() || [];
        } catch (e) {
          this.voices = [];
        }
      };
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = loadVoices;
      }
      loadVoices();
    }
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        try {
          this.audioCtx = new AudioContext();
        } catch (e) {
          console.warn('AudioContext init error:', e);
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
    if (!this.soundEnabled && this.synth) {
      try {
        this.synth.cancel();
      } catch (e) {}
    }
  }

  setHapticEnabled(enabled) {
    this.hapticEnabled = !!enabled;
    localStorage.setItem('df_haptic_enabled', this.hapticEnabled ? 'true' : 'false');
  }

  setVoiceLang(lang) {
    this.voiceLang = lang || 'id-ID';
  }

  // --- Tactile Haptic Feedback for Courtside Phones ---
  vibrate(pattern = 22) {
    if (!this.hapticEnabled) return;
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (e) {}
  }

  // --- Web Audio FX (Zero Latency) ---
  playPointBeep() {
    this.vibrate(20);
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(560, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.075);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.075);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  playUndoBeep() {
    this.vibrate(15);
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.09);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.095);
    } catch (e) {}
  }

  playGameWhistle() {
    this.vibrate([35, 40, 50]);
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174.66, now + 0.11);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.33);
    } catch (e) {}
  }

  playMatchFanfare() {
    this.vibrate([50, 50, 80, 50, 120]);
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        const startTime = this.audioCtx.currentTime + idx * 0.11;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.36);
      });
    } catch (e) {}
  }

  // --- Non-Blocking Debounced Voice Umpire Announcements ---
  speak(text, delayMs = 45) {
    if (!this.soundEnabled || !this.synth || !text) return;

    if (this.speakTimeout) {
      clearTimeout(this.speakTimeout);
    }

    this.speakTimeout = setTimeout(() => {
      try {
        this.synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.voiceLang;
        utterance.rate = 1.08;
        utterance.pitch = 1.0;

        if (!this.voices || this.voices.length === 0) {
          this.voices = this.synth.getVoices() || [];
        }
        if (this.voices.length > 0) {
          const langPrefix = this.voiceLang.slice(0, 2).toLowerCase();
          const match = this.voices.find(v => (v.lang || '').toLowerCase().startsWith(langPrefix));
          if (match) utterance.voice = match;
        }

        this.synth.speak(utterance);
      } catch (e) {
        console.warn('Speech synthesis error:', e);
      }
    }, delayMs);
  }

  announceScore(scoreA, scoreB, isServerA, nameA, nameB, isTiebreak, isGoldenPoint) {
    if (!this.soundEnabled) return;

    if (isTiebreak) {
      const text = this.voiceLang === 'id-ID'
        ? `Tie-break: ${scoreA} - ${scoreB}`
        : `Tie-break: ${scoreA}, ${scoreB}`;
      this.speak(text);
      return;
    }

    if (isGoldenPoint) {
      const text = this.voiceLang === 'id-ID'
        ? `Punto de Oro! Golden Point!`
        : `Golden Point! Deciding point!`;
      this.speak(text);
      return;
    }

    if (scoreA === '40' && scoreB === '40') {
      this.speak('Deuce!');
      return;
    }
    if (scoreA === 'AD') {
      this.speak(this.voiceLang === 'id-ID' ? `Keuntungan ${nameA}` : `Advantage ${nameA}`);
      return;
    }
    if (scoreB === 'AD') {
      this.speak(this.voiceLang === 'id-ID' ? `Keuntungan ${nameB}` : `Advantage ${nameB}`);
      return;
    }

    // Call server score first (official tennis/padel convention)
    const serverScore = isServerA ? scoreA : scoreB;
    const receiverScore = isServerA ? scoreB : scoreA;

    const translatePoint = (pt) => {
      if (pt === '0') return this.voiceLang === 'id-ID' ? 'Kosong' : 'Love';
      if (pt === '15') return this.voiceLang === 'id-ID' ? 'Lima Belas' : 'Fifteen';
      if (pt === '30') return this.voiceLang === 'id-ID' ? 'Tiga Puluh' : 'Thirty';
      if (pt === '40') return this.voiceLang === 'id-ID' ? 'Empat Puluh' : 'Forty';
      return pt;
    };

    if (serverScore === receiverScore) {
      const ptName = translatePoint(serverScore);
      const text = this.voiceLang === 'id-ID' ? `${ptName} sama` : `${ptName} all`;
      this.speak(text);
    } else {
      const text = `${translatePoint(serverScore)} - ${translatePoint(receiverScore)}`;
      this.speak(text);
    }
  }

  announceGame(winnerName, gamesA, gamesB) {
    this.playGameWhistle();
    const text = this.voiceLang === 'id-ID'
      ? `Game untuk ${winnerName}. Skor game: ${gamesA} - ${gamesB}`
      : `Game ${winnerName}. Score is ${gamesA} - ${gamesB}`;
    this.speak(text, 280);
  }

  announceSet(winnerName, setIndex, setsWonA, setsWonB) {
    this.playGameWhistle();
    const text = this.voiceLang === 'id-ID'
      ? `Set ke-${setIndex} dimenangkan oleh ${winnerName}. Skor set: ${setsWonA} - ${setsWonB}`
      : `Set ${setIndex} to ${winnerName}. Sets: ${setsWonA} to ${setsWonB}`;
    this.speak(text, 320);
  }

  announceMatch(winnerName) {
    this.playMatchFanfare();
    const text = this.voiceLang === 'id-ID'
      ? `Game, set, dan pertandingan dimenangkan oleh ${winnerName}!`
      : `Game, set, and match, ${winnerName}!`;
    this.speak(text, 450);
  }

  announceWalkoverWin(winnerName, reasonText) {
    this.playMatchFanfare();
    const text = this.voiceLang === 'id-ID'
      ? `Pertandingan selesai! ${winnerName} dinyatakan menang karena ${reasonText}.`
      : `Match finished! ${winnerName} wins by ${reasonText}.`;
    this.speak(text, 400);
  }

  playAudioUrl(url, onEnded) {
    if (!url || !this.soundEnabled) return null;
    try {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio = null;
      }
      const audio = new Audio(url);
      this.currentAudio = audio;
      if (onEnded) audio.onended = onEnded;
      audio.play().catch(e => console.warn('Failed to play audio url:', e));
      return audio;
    } catch (e) {
      console.warn('Audio play error:', e);
      return null;
    }
  }

  playVictorySlogan(player, fallbackTeamName) {
    if (!this.soundEnabled || !player) return;

    if (player.slogan_audio_url) {
      setTimeout(() => {
        this.playAudioUrl(player.slogan_audio_url);
      }, 900);
      return;
    }

    if (player.slogan_text) {
      this.speak(`Slogan dari ${player.name || fallbackTeamName}: "${player.slogan_text}"`, 1100);
    }
  }

  announceSideSwitch() {
    this.playGameWhistle();
    const text = this.voiceLang === 'id-ID'
      ? `Pindah sisi lapangan!`
      : `Change sides!`;
    this.speak(text, 250);
  }
}

window.soundEngine = new SoundEngine();
