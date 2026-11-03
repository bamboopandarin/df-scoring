/**
 * Sound Engine & Voice Umpire for Padel Tennis Match Master
 * Uses Web Audio API for sound effects and Web Speech API for voice announcements
 */

class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
    this.voiceLang = 'id-ID'; // 'id-ID' or 'en-US'
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    
    if (this.synth) {
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => {
          this.voices = this.synth.getVoices();
        };
      }
      this.voices = this.synth.getVoices();
    }
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
  }

  setVoiceLang(lang) {
    this.voiceLang = lang;
  }

  // --- Web Audio FX ---
  playPointBeep() {
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      // Quick pop frequency drop like a tennis ball strike
      osc.frequency.setValueAtTime(520, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, this.audioCtx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.4, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.08);
    } catch (e) {
      console.warn("Audio error:", e);
    }
  }

  playGameWhistle() {
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
      osc.frequency.setValueAtTime(1108, this.audioCtx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.35);
    } catch (e) {
      console.warn("Audio error:", e);
    }
  }

  playMatchFanfare() {
    if (!this.soundEnabled) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, High C
      notes.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        const startTime = this.audioCtx.currentTime + (idx * 0.12);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.35);
      });
    } catch (e) {
      console.warn("Fanfare error:", e);
    }
  }

  // --- Voice Umpire Announcements ---
  speak(text) {
    if (!this.soundEnabled || !this.synth) return;

    try {
      this.synth.cancel(); // Stop any pending utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.voiceLang;
      utterance.rate = 1.05; // Slightly upbeat referee pace
      utterance.pitch = 1.0;

      // Try to select matching voice
      if (this.voices.length > 0) {
        const match = this.voices.find(v => v.lang.startsWith(this.voiceLang.slice(0, 2)));
        if (match) utterance.voice = match;
      }

      this.synth.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error:", e);
    }
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

    // Standard scoring
    if (scoreA === '40' && scoreB === '40') {
      this.speak("Deuce!");
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

    // Call server score first (official tennis convention)
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
    setTimeout(() => this.speak(text), 400);
  }

  announceSet(winnerName, setIndex, setsWonA, setsWonB) {
    this.playGameWhistle();
    const text = this.voiceLang === 'id-ID'
      ? `Set ke-${setIndex} dimenangkan oleh ${winnerName}. Skor set: ${setsWonA} - ${setsWonB}`
      : `Set ${setIndex} to ${winnerName}. Sets: ${setsWonA} to ${setsWonB}`;
    setTimeout(() => this.speak(text), 500);
  }

  announceMatch(winnerName) {
    this.playMatchFanfare();
    const text = this.voiceLang === 'id-ID'
      ? `Game, set, dan pertandingan dimenangkan oleh ${winnerName}!`
      : `Game, set, and match, ${winnerName}!`;
    setTimeout(() => this.speak(text), 600);
  }

  announceWalkoverWin(winnerName, reasonText) {
    this.playMatchFanfare();
    const text = this.voiceLang === 'id-ID'
      ? `Pertandingan selesai! ${winnerName} dinyatakan menang karena ${reasonText}.`
      : `Match finished! ${winnerName} wins by ${reasonText}.`;
    setTimeout(() => this.speak(text), 500);
  }

  // Play custom audio file (e.g. recorded player slogan)
  playAudioUrl(url, onEnded) {
    if (!url || !this.soundEnabled) return null;
    try {
      const audio = new Audio(url);
      if (onEnded) audio.onended = onEnded;
      audio.play().catch(e => console.warn("Failed to play audio url:", e));
      return audio;
    } catch (e) {
      console.warn("Audio play error:", e);
      return null;
    }
  }

  // Play Player Victory Slogan (Audio file first, or TTS fallback)
  playVictorySlogan(player, fallbackTeamName) {
    if (!this.soundEnabled || !player) return;

    if (player.slogan_audio_url) {
      // Play recorded voice
      setTimeout(() => {
        this.playAudioUrl(player.slogan_audio_url);
      }, 1200);
      return;
    }

    if (player.slogan_text) {
      // Speak slogan text
      setTimeout(() => {
        const text = `Slogan dari ${player.name || fallbackTeamName}: "${player.slogan_text}"`;
        this.speak(text);
      }, 1500);
    }
  }

  announceSideSwitch() {
    this.playGameWhistle();
    const text = this.voiceLang === 'id-ID'
      ? `Pindah sisi lapangan!`
      : `Change sides!`;
    setTimeout(() => this.speak(text), 300);
  }
}

// Global instance
window.soundEngine = new SoundEngine();
