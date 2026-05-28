/* ═══════════════════════════════════════════════════════════════
   DAHAKAN — Main Renderer Entry Point
   ═══════════════════════════════════════════════════════════════ */

// Styles
import './styles/fonts.css';
import './styles/main.css';
import './styles/orb.css';
import './styles/panels.css';

// Modules
import { OrbScene } from './orb/scene';
import { EnergyOrb, OrbState } from './orb/energy-orb';
import { ParticleSystem } from './orb/particles';
import { ChatPanel } from './panels/chat';
import { SystemInfoPanel } from './panels/system-info';
import { WaveformVisualizer } from './panels/waveform';
import { TransitionManager } from './animations/transitions';

/* ── Preload API Type Declaration ───────────────────────────── */
interface DahakanAPI {
  ai: {
    ask: (message: string) => Promise<string>;
    askStream: (message: string, onChunk: (chunk: string) => void) => Promise<void>;
    clearHistory: () => Promise<void>;
    greeting: () => Promise<string>;
    macroMatch: (message: string) => Promise<string[] | null>;
  };
  voice: {
    startListening: () => Promise<void>;
    stopListening: () => Promise<string>;
    sendAudioChunk: (chunk: Uint8Array) => void;
    speak: (text: string) => Promise<void>;
    stopSpeaking: () => Promise<void>;
  };
  system: {
    runCommand: (cmd: string) => Promise<string>;
    openApp: (name: string) => Promise<string>;
    getInfo: () => Promise<any>;
    searchFile: (query: string) => Promise<string[]>;
  };
  features: {
    setReminder: (minutes: number, message: string) => Promise<void>;
    searchWeb: (query: string) => Promise<string>;
    analyzeScreen: (question?: string) => Promise<string>;
    focusStart: (minutes: number, task: string) => Promise<boolean>;
    focusStop: () => Promise<boolean>;
    focusStatus: () => Promise<{ active: boolean; task?: string; remainingMin?: number }>;
  };
  window: {
    minimize: () => void;
    close: () => void;
    toggleOverlay: () => void;
    quit: () => void;
    show: () => void;
    hide: () => void;
  };
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    dahakan: DahakanAPI;
  }
}

/* ── State Labels ───────────────────────────────────────────── */
const STATE_LABELS: Record<OrbState, string> = {
  [OrbState.IDLE]: 'HAZIR',
  [OrbState.LISTENING]: 'DİNLİYOR',
  [OrbState.THINKING]: 'DÜŞÜNÜYOR',
  [OrbState.SPEAKING]: 'KONUŞUYOR',
};

/* ── VAD Tuning Constants ───────────────────────────────────── */
// Eşik düşürüldü: sessiz/normal ses tonunu yakala. Ambient drone speech sırasında
// 0.005'e duck'lanıyor, dolayısıyla 0.008 eşiği false-positive vermez.
const VAD_VOLUME_THRESHOLD = 0.008;
// Bekleme süresi: düşünürken kelimeler arası boşlukları zara koruyacak şekilde uzun.
const VAD_SILENCE_MS = 1600;
// Kısa "evet/hayır/yo" cevaplarının kesilmemesi için daha düşük.
const VAD_MIN_UTTERANCE_MS = 180;
const VAD_POLL_MS = 80;
// TTS bittikten sonra mic'in yeniden açılmadan önce beklediği süre. ElevenLabs
// stereo TTS sonunda tail/echo gelebiliyor; çok kısa açarsak Dahakan kendi sesini yakalıyor.
const POST_TTS_GRACE_MS = 600;
// Continuous mode'da bu kadar süre boyunca hiçbir konuşma algılanmazsa Dahakan
// otomatik uykuya geçer — kendisi VAD'i kıyar, ambient'ı düşürür, sleep modu açar.
const AUTO_SLEEP_MS = 10 * 60 * 1000; // 10 dakika

/* ── Wake word — devamlı dinlemede sadece adı geçenleri işle ──
   Whisper "Dahakan"ı sık sık "Daha kan", "Da hakan", "Daakan", "Hakan" diye yazar.
   Normalize edip içeriyor mu diye bakıyoruz (boşluk/noktalama yutuluyor).
*/
const WAKE_NEEDLES = [
  'dahakan', 'daakan', 'dahakam', 'hakan',
  // Whisper varyantları — sonu 'l' veya yutulmuş
  'dahakal', 'daakal', 'dahaka', 'hakal',
];

/* ── Sleep / Wake / Open komutları
   "Dahakan, uyu" → pencere gizle, wake-only modda mic dinle
   "Dahakan, uyan" veya "Dahakan, açıl" → pencere göster, normal continuous mode
*/
const SLEEP_NEEDLES = [
  'kendiniuyut', 'kendiniuyut',
  'uyu', 'uyuyabilirsin', 'uyuyabilir',
  'uykuyada', 'uykuya', 'uykugir',
];
const WAKE_NEEDLES_SLEEP = [
  'uyan', 'uyandı', 'uyanır', 'uyanmış',
  'açıl', 'açılır', 'aç',
  'kendinaç', 'kendiniac', 'kendiniaç',
];

/** Bir cümle yeterince kısa mı? (komut mu yoksa açıklama mı?) */
function isShortCommand(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length <= 6;
}

function isSleepCommand(text: string): boolean {
  if (!isShortCommand(text)) return false; // uzun cümlede "uyu" geçse de komut sayma
  const n = text.toLowerCase().replace(/[\s\-_.,!?'"`]/g, '');
  const hasName = WAKE_NEEDLES.some((w) => n.includes(w)) || n.includes('kendini');
  return hasName && SLEEP_NEEDLES.some((s) => n.includes(s));
}

function isWakeCommand(text: string): boolean {
  if (!isShortCommand(text)) return false;
  const n = text.toLowerCase().replace(/[\s\-_.,!?'"`]/g, '');
  return WAKE_NEEDLES_SLEEP.some((w) => n.includes(w));
}

/* ── Quit komutu — Dahakan'ı tamamen kapat
   Whisper "kapat"ı sık "kafa hat", "kafat", "kapay" diye yazıyor; toleranslı eşle.
*/
const QUIT_NEEDLES = [
  // doğru transkriptler
  'kendinikapat',
  'kapatkendini',
  'çıkışyap',
  'cikisyap',
  'uygulamayikapat',
  'uygulamayıkapat',
  // Whisper varyantları
  'kendinikafahat',
  'kendinikafat',
  'kendinikafa',
  'kendinikapay',
  'kendinkapat',
  'kendinikapt',
];

function isQuitCommand(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[\s\-_.,!?'"`]/g, '');
  if (QUIT_NEEDLES.some((n) => normalized.includes(n))) return true;
  // Heuristik: "kendini" + "kapat"a benzer bir token (kafa, kafat, kapay, vb.) yakın geçiyorsa
  if (normalized.includes('kendini')) {
    const idx = normalized.indexOf('kendini');
    const after = normalized.slice(idx + 'kendini'.length, idx + 'kendini'.length + 12);
    // "kapat" çekirdeği k-a-p/f-a-t/h-a-t paterni
    if (/^(kap|kaf|kafa|kapatma|kapatan)/.test(after)) return true;
  }
  return false;
}

function hasWakeWord(text: string): boolean {
  // Tüm whitespace ve noktalamayı kaldır, lowercase yap
  const normalized = text.toLowerCase().replace(/[\s\-_.,!?'"`]/g, '');
  return WAKE_NEEDLES.some((needle) => normalized.includes(needle));
}

function stripWakeWord(text: string): string {
  // Wake word varyantlarını söküp temizle
  let out = text;
  const patterns = [
    /\b(hey\s+)?dahakan'?[a-zçğıöşü]*/gi,
    /\bdaakan'?[a-zçğıöşü]*/gi,
    /\bdahakam'?[a-zçğıöşü]*/gi,
    /\bda\s+hakan'?[a-zçğıöşü]*/gi,
    /\bdaha\s+kan'?[a-zçğıöşü]*/gi,
    /\bhakan'?[a-zçğıöşü]*/gi,
  ];
  for (const p of patterns) {
    out = out.replace(p, ' ');
  }
  return out.replace(/\s+/g, ' ').replace(/^[,.;:!?\s]+/, '').trim();
}

/* ═══════════════════════════════════════════════════════════════
   Application Bootstrap
   ═══════════════════════════════════════════════════════════════ */
class DahakanApp {
  // Core
  private orbScene: OrbScene;
  private energyOrb: EnergyOrb;
  private particles: ParticleSystem;

  // Panels
  private chatPanel: ChatPanel;
  private systemPanel: SystemInfoPanel;
  private waveform: WaveformVisualizer;

  // Coordination
  private transitions: TransitionManager;
  private statusIndicator: HTMLElement;

  // State
  private isListening = false;
  private isProcessing = false;
  private isSpeaking = false;
  private systemInfoTimer: ReturnType<typeof setInterval> | null = null;

  // Audio playback (robust via Web Audio API)
  private audioCtx: AudioContext | null = null;
  private playbackSource: AudioBufferSourceNode | null = null;
  // Streaming TTS — gelen audio buffer'larını sırayla çal, üstüste binmesin.
  private audioQueue: Uint8Array[] = [];
  private isPlayingAudio = false;
  // Henüz ses olarak gelmemiş, ElevenLabs'a gitmiş ama buffer dönmemiş istek sayısı.
  // VAD bu sıfırdan büyük olduğu sürece de "isSpeaking" gibi davranır → kendi sesini kaydetmez.
  private pendingTtsRequests = 0;

  // Ambient drone (sci-fi atmospheric pad)
  private ambientGain: GainNode | null = null;
  private ambientStopped = false;

  // Single-shot mic
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  // Continuous listening (VAD)
  private continuousActive = false;
  private continuousStream: MediaStream | null = null;
  private continuousAnalyser: AnalyserNode | null = null;
  private continuousRecorder: MediaRecorder | null = null;
  private continuousChunks: Blob[] = [];
  private continuousPollTimer: ReturnType<typeof setInterval> | null = null;
  private vadSpeechStartedAt = 0;
  private vadLastSpeechAt = 0;
  private vadIsRecording = false;
  // Wake word'den sonra 25 sn diyalog devam etsin (Siri tarzı)
  private conversationActiveUntil = 0;
  // Sleep mode — pencere gizli, sadece "uyan" tetikler
  private isAsleep = false;
  // Continuous mode'da en son ne zaman konuşuldu (auto-sleep için)
  private lastInteractionAt = 0;
  // Mic mute toggle — Ctrl+Shift+M ile aç/kapat (sleep'ten farklı, sadece dinlemeyi durdurur)
  private micMuted = false;

  constructor() {
    // 1. Three.js Scene
    const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement;
    this.orbScene = new OrbScene(canvas);

    // 2. Energy Orb
    const scene = this.orbScene.getScene();
    this.energyOrb = new EnergyOrb(scene);

    // 3. Particle System
    this.particles = new ParticleSystem(scene);

    // 4. UI Panels
    this.chatPanel = new ChatPanel();
    this.systemPanel = new SystemInfoPanel();

    const waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
    this.waveform = new WaveformVisualizer(waveformCanvas);

    // 5. Transition Manager
    this.transitions = new TransitionManager(this.energyOrb, this.particles);

    // 6. Status Indicator
    this.statusIndicator = document.getElementById('status-indicator')!;

    // Setup everything
    this.setupRenderLoop();
    this.setupChatFlow();
    this.setupMicFlow();
    this.setupContinuousFlow();
    this.setupAudioPlayback();
    this.setupAudioUnlock();
    this.setupWindowControls();
    this.setupFocusListener();
    this.startSystemInfoPolling();
    this.showWelcomeMessage();
    this.setStatus(OrbState.IDLE);

    // Start rendering
    this.orbScene.start();

    // Auto-start continuous listening — gerçek bir asistan gibi her zaman hazır olsun
    setTimeout(() => {
      this.startContinuous().catch((err) => {
        console.error('[Dahakan] Auto continuous başlatılamadı:', err);
      });
    }, 1200);
  }

  /* ── Render Loop ──────────────────────────────────────────── */
  private setupRenderLoop(): void {
    this.orbScene.onRender((time: number) => {
      this.energyOrb.update(time);
      this.particles.update(time);
    });
  }

  /* ── Audio Unlock (Chromium autoplay policy) ───────────────── */
  private setupAudioUnlock(): void {
    const unlock = async () => {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
        console.log('[Dahakan Renderer] AudioContext oluşturuldu, sampleRate:', this.audioCtx.sampleRate);
      }
      if (this.audioCtx.state === 'suspended') {
        try {
          await this.audioCtx.resume();
          console.log('[Dahakan Renderer] AudioContext resume edildi');
        } catch (err) {
          console.error('[Dahakan Renderer] AudioContext resume hatası:', err);
        }
      }
      // Start ambient drone once unlocked
      this.startAmbient();
    };
    window.addEventListener('click', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    unlock();
  }

  /* ── Ambient Sci-fi Drone ────────────────────────────────── */
  private startAmbient(): void {
    if (!this.audioCtx || this.ambientGain || this.ambientStopped) return;
    const ctx = this.audioCtx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // Low-pass filter for warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 1.0;
    filter.connect(master);

    // Three detuned sine oscillators — A1, E2, A2 (warm pad)
    const freqs = [55, 82.4, 110];
    const oscs: OscillatorNode[] = [];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      o.connect(g);
      g.connect(filter);
      o.start();
      oscs.push(o);
    }

    // Slow LFO modulating filter cutoff for organic breath
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    // Fade in slowly so it doesn't startle
    master.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);

    this.ambientGain = master;
    console.log('[Dahakan Renderer] Ambient drone başlatıldı');
  }

  /** Duck ambient volume during speech, restore after.
   * VAD eşiği 0.008 olduğu için active sırasında ambient 0.003'e iniyor (eşiğin altı).
   * Idle'da da 0.035 — eskisinin daha sakin hali, mikrofonu zorlamasın. */
  private duckAmbient(active: boolean): void {
    if (!this.audioCtx || !this.ambientGain) return;
    const now = this.audioCtx.currentTime;
    const target = active ? 0.003 : 0.035;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.linearRampToValueAtTime(target, now + 0.4);
  }

  /* ── Chat Flow ────────────────────────────────────────────── */
  private setupChatFlow(): void {
    this.chatPanel.onSend(async (text: string) => {
      if (this.isProcessing) return;
      await this.handleUserMessage(text);
    });
  }

  private async handleUserMessage(text: string): Promise<void> {
    if (isQuitCommand(text)) {
      this.chatPanel.addMessage(text, 'user');
      await this.handleQuitCommand();
      return;
    }
    if (this.isAsleep && isWakeCommand(text)) {
      this.chatPanel.addMessage(text, 'user');
      await this.handleWakeCommand();
      return;
    }
    if (!this.isAsleep && isSleepCommand(text)) {
      this.chatPanel.addMessage(text, 'user');
      await this.handleSleepCommand();
      return;
    }
    // Makro eşleşmesi var mı? Varsa adımları sırayla çağır
    try {
      const steps = await window.dahakan.ai.macroMatch(text);
      if (steps && steps.length > 0) {
        this.chatPanel.addMessage(text, 'user');
        this.chatPanel.addMessage(`(Makro tetiklendi: ${steps.length} adım çalıştırılıyor)`, 'dahakan');
        for (const step of steps) {
          await this.handleUserMessageNoBlock(step);
        }
        return;
      }
    } catch (err) {
      console.warn('[Dahakan] Makro kontrol hatası:', err);
    }

    this.isProcessing = true;
    this.chatPanel.setInputEnabled(false);

    // Add user message
    this.chatPanel.addMessage(text, 'user');

    // Transition to THINKING
    this.setStatus(OrbState.THINKING);

    let fullResponse = '';
    const speaker = this.createStreamingSpeaker();
    try {
      const streamEl = this.chatPanel.startStreaming();
      let firstChunk = true;

      await window.dahakan.ai.askStream(text, (chunk: string) => {
        if (firstChunk) {
          this.setStatus(OrbState.SPEAKING);
          firstChunk = false;
        }
        this.chatPanel.appendToStream(streamEl, chunk);
        fullResponse += chunk;
        const amplitude = Math.min(chunk.length / 20, 1.0);
        this.transitions.setVoiceAmplitude(amplitude);
        // Streaming TTS — cümle dolduğunda anında konuşmaya başlar
        void speaker.push(chunk);
      });

      this.chatPanel.finishStreaming(streamEl);
      // Kalan kısmı boşalt (cümle bitmemiş olabilir)
      await speaker.flush();
    } catch (err) {
      console.error('AI stream error:', err);
      this.chatPanel.addMessage('Bağlantı hatası oluştu. Tekrar dene.', 'dahakan');
    }

    // Status playback bittiğinde playNextInQueue() tarafından IDLE/LISTENING'e döner
    this.isProcessing = false;
    this.chatPanel.setInputEnabled(true);
    this.chatPanel.focusInput();
  }

  /* ── Single-shot Mic Flow ─────────────────────────────────── */
  private setupMicFlow(): void {
    this.chatPanel.onMicClick(async () => {
      // If continuous mode is on, single-shot mic should be ignored
      if (this.continuousActive) {
        this.chatPanel.addMessage('Sürekli dinleme aktif — direkt konuş.', 'dahakan');
        return;
      }
      if (this.isProcessing) return;

      if (!this.isListening) {
        this.isListening = true;
        this.chatPanel.setMicListening(true);
        this.setStatus(OrbState.LISTENING);
        this.waveform.setActive(true);

        try {
          await window.dahakan.voice.startListening();
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.recordedChunks = [];
          this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
          };

          this.mediaRecorder.start();
        } catch (err) {
          console.error('Mic start error:', err);
          this.isListening = false;
          this.chatPanel.setMicListening(false);
          this.setStatus(OrbState.IDLE);
          this.waveform.setActive(false);
        }
      } else {
        this.isListening = false;
        this.chatPanel.setMicListening(false);
        this.waveform.setActive(false);

        const recorder = this.mediaRecorder;
        if (recorder && recorder.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
            recorder.stop();
          });
          recorder.stream.getTracks().forEach((track) => track.stop());
          this.mediaRecorder = null;
        }

        try {
          if (this.recordedChunks.length > 0) {
            const fullBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
            const buffer = await fullBlob.arrayBuffer();
            window.dahakan.voice.sendAudioChunk(new Uint8Array(buffer));
            this.recordedChunks = [];
          }

          const transcript = await window.dahakan.voice.stopListening();
          if (transcript && transcript.trim().length > 0) {
            await this.handleUserMessage(transcript.trim());
          } else {
            this.chatPanel.addMessage('Seni duyamadım. Tekrar dener misin?', 'dahakan');
            this.setStatus(OrbState.IDLE);
          }
        } catch (err) {
          console.error('Mic stop error:', err);
          this.setStatus(OrbState.IDLE);
        }
      }
    });
  }

  /* ── Continuous Listening (VAD) ───────────────────────────── */
  private setupContinuousFlow(): void {
    this.chatPanel.onContinuousToggle(async () => {
      if (this.continuousActive) {
        await this.stopContinuous();
      } else {
        await this.startContinuous();
      }
    });
  }

  private async startContinuous(): Promise<void> {
    try {
      // Ensure AudioContext exists (needed for AnalyserNode)
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.continuousStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          // AGC kapalı: sessiz ortamda gain patlayıp paraziti konuşma sanıyordu,
          // ilk hecede AGC settle olmadığı için kayıp da yaratıyordu.
          autoGainControl: false,
        },
      });

      const source = this.audioCtx.createMediaStreamSource(this.continuousStream);
      this.continuousAnalyser = this.audioCtx.createAnalyser();
      this.continuousAnalyser.fftSize = 1024;
      this.continuousAnalyser.smoothingTimeConstant = 0.8;
      source.connect(this.continuousAnalyser);

      this.continuousActive = true;
      this.chatPanel.setContinuousActive(true);
      this.waveform.setActive(true);
      this.setStatus(OrbState.LISTENING);
      this.chatPanel.addMessage('Sürekli dinleme açık. Konuş, ben dinliyorum.', 'dahakan');

      this.vadIsRecording = false;
      this.startVadPolling();
    } catch (err) {
      console.error('Continuous start error:', err);
      this.chatPanel.addMessage('Mikrofon erişimi alınamadı.', 'dahakan');
      this.continuousActive = false;
      this.chatPanel.setContinuousActive(false);
    }
  }

  private async stopContinuous(): Promise<void> {
    this.continuousActive = false;
    this.chatPanel.setContinuousActive(false);
    this.waveform.setActive(false);

    if (this.continuousPollTimer) {
      clearInterval(this.continuousPollTimer);
      this.continuousPollTimer = null;
    }

    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      try {
        this.continuousRecorder.stop();
      } catch {}
    }
    this.continuousRecorder = null;
    this.continuousChunks = [];

    if (this.continuousStream) {
      this.continuousStream.getTracks().forEach((t) => t.stop());
      this.continuousStream = null;
    }
    this.continuousAnalyser = null;

    this.setStatus(OrbState.IDLE);
    this.chatPanel.addMessage('Sürekli dinleme kapatıldı.', 'dahakan');
  }

  private startVadPolling(): void {
    if (!this.continuousAnalyser) return;
    const buf = new Uint8Array(this.continuousAnalyser.fftSize);
    this.lastInteractionAt = performance.now();

    this.continuousPollTimer = setInterval(() => {
      if (!this.continuousActive || !this.continuousAnalyser) return;
      // Muted veya speaking/processing sırasında VAD geçici durdur
      if (this.micMuted) return;
      // Streaming TTS sırasında: aktif ses çalıyor, kuyrukta bekleyen var veya
      // hala beklenen bir TTS network isteği var — hepsinde mic'i kaydetme
      if (this.isSpeaking || this.isProcessing) return;
      if (this.audioQueue.length > 0 || this.pendingTtsRequests > 0) return;

      this.continuousAnalyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const now = performance.now();

      const isSpeech = rms > VAD_VOLUME_THRESHOLD;
      this.transitions.setVoiceAmplitude(Math.min(rms * 6, 1.0));

      if (isSpeech) {
        if (!this.vadIsRecording) {
          this.startVadRecording();
          this.vadSpeechStartedAt = now;
        }
        this.vadLastSpeechAt = now;
        this.lastInteractionAt = now;
      } else if (this.vadIsRecording) {
        const silenceFor = now - this.vadLastSpeechAt;
        const utteranceLen = now - this.vadSpeechStartedAt;
        if (silenceFor > VAD_SILENCE_MS && utteranceLen > VAD_MIN_UTTERANCE_MS) {
          this.finishVadRecording();
        } else if (silenceFor > VAD_SILENCE_MS) {
          // Too short, discard
          this.cancelVadRecording();
        }
      } else if (!this.isAsleep && (now - this.lastInteractionAt) > AUTO_SLEEP_MS) {
        // Uzun süre konuşma yok → otomatik uykuya geç (sessizce, TTS olmadan)
        console.log('[Dahakan VAD] 10 dk inaktivite → otomatik uyku');
        void this.handleAutoSleep();
      }
    }, VAD_POLL_MS);
  }

  /** Auto-sleep: kullanıcı uzun süre konuşmadıysa sessizce uyku moduna geç. */
  private async handleAutoSleep(): Promise<void> {
    this.isAsleep = true;
    this.lastInteractionAt = performance.now();
    this.chatPanel.addMessage('(Bir süre konuşmadın, uykuya geçiyorum. Adımı söylersen uyanırım.)', 'dahakan');
    window.dahakan.window.hide();
    this.setStatus(OrbState.IDLE);
  }

  /** Ctrl+Shift+M ile çağrılır — continuous mode'u sustur/aç (sleep'ten farklı). */
  private toggleMicMute(): void {
    this.micMuted = !this.micMuted;
    if (this.micMuted) {
      this.cancelVadRecording();
      this.chatPanel.addMessage('Mikrofon susturuldu. Açmak için yine Ctrl+Shift+M.', 'dahakan');
    } else {
      this.lastInteractionAt = performance.now();
      this.chatPanel.addMessage('Mikrofon tekrar açık.', 'dahakan');
    }
  }

  private startVadRecording(): void {
    if (!this.continuousStream) return;
    try {
      this.continuousChunks = [];
      this.continuousRecorder = new MediaRecorder(this.continuousStream, {
        mimeType: 'audio/webm',
      });
      this.continuousRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.continuousChunks.push(e.data);
      };
      this.continuousRecorder.start();
      this.vadIsRecording = true;
      this.setStatus(OrbState.LISTENING);
    } catch (err) {
      console.error('VAD recorder start error:', err);
    }
  }

  private cancelVadRecording(): void {
    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      try {
        this.continuousRecorder.stop();
      } catch {}
    }
    this.continuousRecorder = null;
    this.continuousChunks = [];
    this.vadIsRecording = false;
  }

  private async finishVadRecording(): Promise<void> {
    const recorder = this.continuousRecorder;
    if (!recorder) {
      this.vadIsRecording = false;
      return;
    }
    this.vadIsRecording = false;
    this.setStatus(OrbState.THINKING);
    this.isProcessing = true;

    try {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      const chunks = this.continuousChunks;
      this.continuousChunks = [];
      this.continuousRecorder = null;

      if (chunks.length === 0) {
        this.isProcessing = false;
        if (this.continuousActive) this.setStatus(OrbState.LISTENING);
        return;
      }

      const fullBlob = new Blob(chunks, { type: 'audio/webm' });
      const buffer = await fullBlob.arrayBuffer();

      // Send to backend for STT
      await window.dahakan.voice.startListening();
      window.dahakan.voice.sendAudioChunk(new Uint8Array(buffer));
      const transcript = await window.dahakan.voice.stopListening();
      const cleaned = (transcript || '').trim();

      if (cleaned.length === 0) {
        this.isProcessing = false;
        if (this.continuousActive) this.setStatus(OrbState.LISTENING);
        return;
      }

      // Sleep modunda sadece "uyan" / "açıl" tetikler — diğer her şey yutuluyor
      if (this.isAsleep) {
        if (isWakeCommand(cleaned)) {
          console.log('[Dahakan VAD] Uyandırma komutu algılandı');
          await this.handleWakeCommand();
        } else {
          console.log('[Dahakan VAD] Uykuda, yutuldu:', JSON.stringify(cleaned));
        }
        this.isProcessing = false;
        if (this.continuousActive) this.setStatus(OrbState.LISTENING);
        return;
      }

      // Kapatma komutu mu?
      if (isQuitCommand(cleaned)) {
        console.log('[Dahakan VAD] Kapatma komutu algılandı');
        await this.handleQuitCommand();
        return;
      }

      // Uyku komutu mu?
      if (isSleepCommand(cleaned)) {
        console.log('[Dahakan VAD] Uyku komutu algılandı');
        await this.handleSleepCommand();
        return;
      }

      // Continuous mode aktifse her utterance AI'a gider — kullanıcı zaten ∞ toggle ile açtı
      // İstenirse adı söylendiğinde de baştaki wake-word söker
      const command = hasWakeWord(cleaned) ? (stripWakeWord(cleaned) || cleaned) : cleaned;
      console.log('[Dahakan VAD] Komut:', JSON.stringify(command));

      await this.handleUserMessageNoBlock(command);
    } catch (err) {
      console.error('VAD finish error:', err);
      this.isProcessing = false;
      if (this.continuousActive) this.setStatus(OrbState.LISTENING);
    }
  }

  /** "Dahakan uyu" — pencereyi gizle, wake-only modda dinle */
  private async handleSleepCommand(): Promise<void> {
    this.isAsleep = true;
    const msg = 'Tamam, uyuyorum. Uyandırmak için adımı söyle.';
    this.chatPanel.addMessage(msg, 'dahakan');
    this.setStatus(OrbState.SPEAKING);

    try {
      await window.dahakan.voice.speak(msg);
      const start = performance.now();
      while (this.isSpeaking && performance.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch {}

    // Continuous dinlemeyi koru (wake bekliyoruz) ama pencereyi gizle
    window.dahakan.window.hide();
    this.setStatus(OrbState.IDLE);
    this.isProcessing = false;
    console.log('[Dahakan] Uykuya geçildi');
  }

  /** "Dahakan uyan / açıl" — pencereyi göster, normal continuous mode'a dön */
  private async handleWakeCommand(): Promise<void> {
    this.isAsleep = false;
    window.dahakan.window.show();

    // Eğer continuous mode aktif değilse aç
    if (!this.continuousActive) {
      try {
        await this.startContinuous();
      } catch (err) {
        console.error('Wake startContinuous error:', err);
      }
    }

    const msg = 'Buradayım, dinliyorum.';
    this.chatPanel.addMessage(msg, 'dahakan');
    this.setStatus(OrbState.SPEAKING);
    try {
      await window.dahakan.voice.speak(msg);
    } catch {}
    this.isProcessing = false;
    console.log('[Dahakan] Uyandı');
  }

  /** "Kendini kapat" komutuna tepki: kısa veda + TTS bitince app.quit() */
  private async handleQuitCommand(): Promise<void> {
    this.isProcessing = true;
    const farewell = 'Görüşürüz, kendimi kapatıyorum.';
    this.chatPanel.addMessage(farewell, 'dahakan');
    this.setStatus(OrbState.SPEAKING);

    // Continuous'u durdur, mic ve ambient kapat
    if (this.continuousActive) {
      try { await this.stopContinuous(); } catch {}
    }
    if (this.ambientGain && this.audioCtx) {
      try {
        const now = this.audioCtx.currentTime;
        this.ambientGain.gain.cancelScheduledValues(now);
        this.ambientGain.gain.linearRampToValueAtTime(0, now + 0.3);
      } catch {}
    }

    try {
      // Speak the farewell. ElevenLabs TTS audio gets dispatched to renderer audio-play,
      // which sets isSpeaking until onended fires.
      await window.dahakan.voice.speak(farewell);
      // Audio is queued; poll briefly until playback completes (max 6 sn fallback)
      const start = performance.now();
      while (this.isSpeaking && performance.now() - start < 6000) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.error('Quit veda hatası:', err);
    }

    // Tamamen kapat — main process app.quit() çağıracak, electron-vite dev de sonlanır
    console.log('[Dahakan Renderer] Quit IPC gönderiliyor');
    window.dahakan.window.quit();
  }

  /** Variant of handleUserMessage that doesn't touch input enable (continuous mode owns the flow) */
  private async handleUserMessageNoBlock(text: string): Promise<void> {
    this.chatPanel.addMessage(text, 'user');
    this.setStatus(OrbState.THINKING);

    let fullResponse = '';
    const speaker = this.createStreamingSpeaker();
    try {
      const streamEl = this.chatPanel.startStreaming();
      let firstChunk = true;
      await window.dahakan.ai.askStream(text, (chunk: string) => {
        if (firstChunk) {
          this.setStatus(OrbState.SPEAKING);
          firstChunk = false;
        }
        this.chatPanel.appendToStream(streamEl, chunk);
        fullResponse += chunk;
        void speaker.push(chunk);
      });
      this.chatPanel.finishStreaming(streamEl);
      await speaker.flush();
    } catch (err) {
      console.error('AI stream error:', err);
      this.chatPanel.addMessage('Bağlantı hatası oluştu.', 'dahakan');
    }

    this.isProcessing = false;
    // Audio queue bittiğinde playNextInQueue zaten LISTENING/IDLE'e geçecek
  }

  /* ── Audio Playback via Web Audio API (robust, bypasses autoplay) ───
     Streaming TTS için kuyruğa alma:
       1. Gelen her buffer audioQueue'ya eklenir.
       2. Hiçbir şey çalmıyorsa playNext tetiklenir.
       3. Çalan kaynak bittiğinde onended ile sıradakine geçer.
       4. audio-stop gelirse kuyruk boşalır + aktif kaynak durur. */
  private setupAudioPlayback(): void {
    window.dahakan.on('dahakan:audio-play', (buffer: Uint8Array) => {
      const byteLen = (buffer as any)?.byteLength ?? (buffer as any)?.length ?? 0;
      console.log('[Dahakan Renderer] audio-play geldi, boyut:', byteLen, 'kuyruk:', this.audioQueue.length);
      this.audioQueue.push(buffer);
      if (!this.isPlayingAudio) {
        void this.playNextInQueue();
      }
    });

    window.dahakan.on('dahakan:audio-stop', () => {
      this.audioQueue = [];
      if (this.playbackSource) {
        try { this.playbackSource.stop(); } catch {}
        this.playbackSource = null;
      }
      this.isSpeaking = false;
      this.isPlayingAudio = false;
    });
  }

  private async playNextInQueue(): Promise<void> {
    const buffer = this.audioQueue.shift();
    if (!buffer) {
      // Henüz beklenen TTS isteği varsa kapanma — bir sonraki audio-play eventinde tekrar bu fn devreye girer
      if (this.pendingTtsRequests > 0) {
        return;
      }
      // Kuyruk gerçekten bitti → idle/listen state'e dön
      this.isPlayingAudio = false;
      this.isSpeaking = false;
      this.transitions.setVoiceAmplitude(0);
      this.duckAmbient(false);
      this.conversationActiveUntil = performance.now() + 25_000;
      if (this.continuousActive) {
        setTimeout(() => {
          this.vadLastSpeechAt = performance.now();
          this.setStatus(OrbState.LISTENING);
        }, POST_TTS_GRACE_MS);
      } else if (!this.isProcessing) {
        this.setStatus(OrbState.IDLE);
      }
      return;
    }
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const arrayBuf = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(arrayBuf).set(buffer);

      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuf);
      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioCtx.destination);

      this.isPlayingAudio = true;
      this.isSpeaking = true;
      this.setStatus(OrbState.SPEAKING);
      this.duckAmbient(true);

      source.onended = () => {
        this.playbackSource = null;
        // Sıradaki cümle için devam et — ufak bir tampon ile pürüzsüz akış
        setTimeout(() => void this.playNextInQueue(), 30);
      };

      this.playbackSource = source;
      source.start(0);
      console.log('[Dahakan Renderer] Ses çalıyor, süre:', audioBuffer.duration.toFixed(2), 'sn');

      // Amplitude envelope animasyonu
      const startTime = performance.now();
      const duration = audioBuffer.duration * 1000;
      const animate = () => {
        if (!this.isSpeaking) return;
        const t = (performance.now() - startTime) / duration;
        if (t >= 1) return;
        const env = Math.sin(t * Math.PI * 8) * 0.3 + 0.6;
        this.transitions.setVoiceAmplitude(env);
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    } catch (err) {
      console.error('[Dahakan Renderer] Ses çalma hatası:', err);
      // Hatada da sıradakini dene; sonsuza dek takılma
      setTimeout(() => void this.playNextInQueue(), 30);
    }
  }

  /** LLM cevabı stream gelirken cümle cümle TTS'e gönder.
   *  Cümle bitiş işaretleri: `.`, `?`, `!`. Henüz tamamlanmamış kuyruğu close()'da boşalt.
   *  pendingTtsRequests counter'ı ile VAD'in kendi sesini yakalaması engellenir. */
  private createStreamingSpeaker() {
    let buffer = '';
    let firstSent = false;
    const speakSentence = async (text: string) => {
      this.pendingTtsRequests++;
      try {
        await window.dahakan.voice.speak(text);
        firstSent = true;
      } catch (err) {
        console.warn('[Dahakan Streaming TTS] speak hatası:', err);
      } finally {
        this.pendingTtsRequests--;
      }
    };
    const trySend = async (force: boolean) => {
      while (true) {
        const m = buffer.match(/[^.!?]+[.!?]+["')\]]*\s*/);
        if (!m) break;
        const sentence = m[0].trim();
        buffer = buffer.slice(m[0].length);
        if (sentence.length > 0) {
          await speakSentence(sentence);
        }
      }
      if (force && buffer.trim().length > 0) {
        const rest = buffer.trim();
        buffer = '';
        await speakSentence(rest);
      }
    };
    return {
      push: async (chunk: string) => {
        buffer += chunk;
        if (/[.!?]/.test(chunk)) {
          await trySend(false);
        }
      },
      flush: async () => {
        await trySend(true);
        return firstSent;
      },
    };
  }

  /* ── Window Controls ──────────────────────────────────────── */
  private setupWindowControls(): void {
    const btnMinimize = document.getElementById('btn-minimize');
    const btnClose = document.getElementById('btn-close');

    btnMinimize?.addEventListener('click', () => {
      window.dahakan.window.minimize();
    });

    btnClose?.addEventListener('click', () => {
      window.dahakan.window.close();
    });
  }

  /* ── System Info Polling ──────────────────────────────────── */
  private startSystemInfoPolling(): void {
    const poll = async () => {
      try {
        const info = await window.dahakan.system.getInfo();
        if (info) {
          this.systemPanel.update({
            cpu: info.cpu ?? 0,
            ram: { used: info.ram?.used ?? 0, total: info.ram?.total ?? 0 },
            disk: { used: info.disk?.used ?? 0, total: info.disk?.total ?? 0 },
          });
        }
      } catch {
        // Silently continue polling
      }
    };
    poll();
    this.systemInfoTimer = setInterval(poll, 5000);
  }

  /* ── Status Management ────────────────────────────────────── */
  private setStatus(state: OrbState): void {
    this.transitions.transitionTo(state);
    this.statusIndicator.textContent = STATE_LABELS[state];
    const colorMap: Record<OrbState, string> = {
      [OrbState.IDLE]: 'var(--text-secondary)',
      [OrbState.LISTENING]: 'var(--primary-cyan)',
      [OrbState.THINKING]: 'var(--accent-emerald)',
      [OrbState.SPEAKING]: 'var(--accent-gold)',
    };
    this.statusIndicator.style.color = colorMap[state];
    this.statusIndicator.style.opacity = state === OrbState.IDLE ? '0.6' : '1';
  }

  /* ── Welcome Message ──────────────────────────────────────── */
  private showWelcomeMessage(): void {
    // Proaktif, zaman + memory bazlı karşılama. Eğer AI uzarsa fallback'le hızlı selam ver.
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let alreadyShown = false;

    fallbackTimer = setTimeout(() => {
      if (!alreadyShown) {
        alreadyShown = true;
        this.chatPanel.addMessage('Buradayım. Konuşalım mı?', 'dahakan');
      }
    }, 2500);

    void window.dahakan.ai.greeting().then(async (greeting) => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (alreadyShown) return;
      alreadyShown = true;
      const text = (greeting || 'Buradayım, dinliyorum.').trim();
      this.chatPanel.addMessage(text, 'dahakan');
      try {
        await window.dahakan.voice.speak(text);
      } catch (err) {
        console.warn('[Dahakan] Karşılama sesi çalınamadı:', err);
      }
    }).catch((err) => {
      console.warn('[Dahakan] Karşılama isteği başarısız:', err);
    });
  }

  /** Ctrl+Shift+V — main process global hotkey -> 'dahakan:vision-hotkey' eventi
   *  veya kullanıcı sağdaki kameraya tıklarsa. Renderer tarafı tetiklenebilir. */
  private async triggerVision(question?: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.setStatus(OrbState.THINKING);
    const placeholder = question ? `[Ekrana bak: ${question}]` : '[Ekrana bak]';
    this.chatPanel.addMessage(placeholder, 'user');
    try {
      const result = await window.dahakan.features.analyzeScreen(question);
      this.chatPanel.addMessage(result, 'dahakan');
      try {
        await window.dahakan.voice.speak(result);
      } catch (err) {
        console.warn('[Dahakan Vision] TTS hatası:', err);
      }
    } catch (err) {
      console.error('[Dahakan Vision] Hata:', err);
      this.chatPanel.addMessage('Ekranı analiz ederken bir aksilik oldu.', 'dahakan');
    }
    this.isProcessing = false;
    this.setStatus(this.continuousActive ? OrbState.LISTENING : OrbState.IDLE);
  }

  /** Focus mode IPC eventlerini dinle, statüyü UI'a yansıt */
  private setupFocusListener(): void {
    window.dahakan.on('dahakan:focus-changed', (payload: { active: boolean; task: string }) => {
      if (payload.active) {
        this.chatPanel.addMessage(`Odak modu açık: "${payload.task}". Süre dolunca haber veririm.`, 'dahakan');
        this.statusIndicator.style.color = 'var(--accent-gold)';
      } else {
        this.chatPanel.addMessage('Odak modu bitti. Mola zamanı.', 'dahakan');
      }
    });
    window.dahakan.on('dahakan:vision-hotkey', () => {
      void this.triggerVision();
    });
    window.dahakan.on('dahakan:mute-hotkey', () => {
      this.toggleMicMute();
    });
    // Tray menu intents
    window.dahakan.on('dahakan:tray-briefing', () => {
      void this.handleUserMessage('Bana brifing ver — sabah/akşam saatine göre.');
    });
    window.dahakan.on('dahakan:tray-focus-start', () => {
      void window.dahakan.features.focusStart(25, 'çalışma');
    });
    window.dahakan.on('dahakan:tray-focus-stop', () => {
      void window.dahakan.features.focusStop();
    });
    window.dahakan.on('dahakan:proactive-message', (text: string) => {
      // TTS zaten main process'te tetikleniyor — burada sadece chat'e bas
      this.chatPanel.addMessage(text, 'dahakan');
    });
  }

  /* ── Cleanup ──────────────────────────────────────────────── */
  dispose(): void {
    if (this.systemInfoTimer) clearInterval(this.systemInfoTimer);
    if (this.continuousPollTimer) clearInterval(this.continuousPollTimer);
    if (this.continuousStream) {
      this.continuousStream.getTracks().forEach((t) => t.stop());
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
    this.waveform.dispose();
    this.particles.dispose();
    this.energyOrb.dispose();
    this.orbScene.dispose();
  }
}

/* ═══════════════════════════════════════════════════════════════
   Initialize on DOM Ready
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const app = new DahakanApp();

  window.addEventListener('beforeunload', () => {
    app.dispose();
  });
});
