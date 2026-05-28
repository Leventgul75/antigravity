import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getEnv } from '../utils/env-loader'

// Whisper Türkçe modelinin sessizlik/gürültüde sık tükürdüğü kalıplar.
// Tam eşleşme + içerik bazlı eşleşme kontrolü yapılır (kısa transkriptler için
// tam, uzun transkriptler için substring değil; çünkü gerçek bir cümle içinde
// "teşekkür ederim" geçebilir).
const HALLUCINATION_EXACT = new Set([
  // YouTube/podcast eğitim verisinden sızanlar
  'altyazı m.k.', 'altyazı m.k', 'altyazı m k', 'altyazi m.k',
  'altyazı: m.k.', 'subtitle by m.k.',
  'izlediğiniz için teşekkür ederim.', 'izlediğiniz için teşekkür ederim',
  'izlediğiniz için teşekkürler.', 'izlediğiniz için teşekkürler',
  'beni dinlediğiniz için teşekkür ederim.', 'beni dinlediğiniz için teşekkür ederim',
  'abone olmayı unutmayın.', 'abone olmayı unutmayın',
  'abone olmayı unutmayın!', 'kanalıma abone olun',
  'beğen ve abone ol', 'beğenip abone olmayı unutmayın',
  'videoyu beğenmeyi unutmayın', 'videomuzu beğenmeyi unutmayın',
  'iyi seyirler.', 'iyi seyirler', 'iyi seyirler dilerim.',
  'iyi günler dilerim.', 'iyi günler.',
  'kanalımıza abone olun.', 'görüşmek üzere.',
  // Sessiz hava → ünlem/anlamsız tek kelime
  'hmm.', 'hmm', 'hım.', 'hım', 'ıh.', 'aa.', 'eee.', 'eh.', 'ah.',
  '...', '. .', 'mhm.', 'mhm',
  // Allah/dini ünlemler — sessizlikte sık çıkar
  'allah allah.', 'allah allah', 'aman allahım.', 'aman allahım',
  'hayırlısı.', 'hayırlısı', 'inşallah.', 'inşallah',
  'maşallah.', 'maşallah', 'allah allah allah.',
  // Rastgele tek kelime/parça
  'evet.', 'tamam.', 'peki.', 'olur.', 'oldu.',
  'türkçe.', 'türkçe', 'türkçe altyazı.',
]);

// Substring olarak görünse bile tüm transkript bunlarsa filtreleyeceğimiz kısa kalıplar.
const HALLUCINATION_PATTERNS = [
  /^a+h+\.?$/i,            // "ahh", "aaah"
  /^h?m+\.?$/i,            // "hmm", "mmm"
  /^e+h?\.?$/i,            // "eh", "eee"
  /^[.…]+$/,                // sadece nokta
  /^[\s.]*$/,               // boşluk + nokta
];

function isWhisperHallucination(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  if (t.length === 0) return true;
  if (HALLUCINATION_EXACT.has(t)) return true;
  if (HALLUCINATION_PATTERNS.some((p) => p.test(t))) return true;
  // 2 karakter veya daha az → muhtemelen gürültü
  if (t.replace(/[\s.,!?]/g, '').length <= 2) return true;
  return false;
}

export class SpeechToText {
  private apiKey: string
  // Whisper'a verilecek dil — default tr; SettingsStore'dan güncellenebilir
  private language: string = 'tr'

  constructor() {
    this.apiKey = getEnv('GROQ_API_KEY')
  }

  setLanguage(lang: string): void {
    this.language = (lang || 'tr').toLowerCase().slice(0, 5)
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    if (!audioBuffer || audioBuffer.length === 0) {
      console.warn('[Dahakan STT] Boş ses verisi alındı')
      return ''
    }

    console.log('[Dahakan STT] Ses boyutu:', audioBuffer.length, 'bayt')
    const tempPath = join(tmpdir(), `dahakan-audio-${Date.now()}.webm`)

    try {
      writeFileSync(tempPath, audioBuffer)

      const { default: fetch, FormData, fileFromSync } = await import('node-fetch')

      const file = fileFromSync(tempPath, 'audio/webm')

      const formData = new FormData()
      formData.append('file', file, 'audio.webm')
      formData.append('model', 'whisper-large-v3-turbo')
      formData.append('language', this.language)
      formData.append('response_format', 'json')

      console.log('[Dahakan STT] Groq Whisper\'a gönderiliyor...')
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData as any
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Dahakan STT] API hatası:', response.status, errorText)
        return ''
      }

      const result = await response.json() as { text?: string }
      const transcript = (result.text || '').trim()
      console.log('[Dahakan STT] Transcript:', JSON.stringify(transcript))

      if (isWhisperHallucination(transcript)) {
        console.log('[Dahakan STT] Halüsinasyon filtrelendi')
        return ''
      }

      return transcript
    } catch (error) {
      console.error('[Dahakan STT] Transkripsiyon hatası:', error)
      return ''
    } finally {
      try {
        unlinkSync(tempPath)
      } catch {
        // Temp dosya temizleme hatası önemsiz
      }
    }
  }
}
