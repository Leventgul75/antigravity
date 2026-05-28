import { hasEnv } from '../utils/env-loader'

/** Kullanıcı "ne yapabilirsin" derse — kategorize, doğal Türkçe yetenek listesi. */
export function formatCapabilitiesForAI(): string {
  return `Yapabildiklerim:

Sesli iletişim: Sürekli dinleyebilirim, konuşurken seni keserim, sustuğunda devam ederim. Mikrofonu Ctrl+Shift+M ile kapatıp açabilirsin. Uzun süre konuşmazsan uykuya geçerim.

Hafıza: Hakkındaki bilgileri kalıcı tutarım. "Şunu hatırla" dersen yazarım, "şunu unut" dersen silerim. Bana "hakkımda ne biliyorsun" diye sorabilirsin. Sohbetlerimizi günlük markdown olarak da log'larım.

Ekran ve pano: Ctrl+Shift+V ile ekranını analiz ederim. Panonu okurum, üzerinde işlem yaparım, sonucu panoya yazabilirim. Hangi uygulamada olduğunu görebilirim.

Üretkenlik: Hatırlatıcı kurarım (sesli söylerim), pomodoro/odak modu başlatırım, not alırım ve ararım, dosya okurum (Masaüstü/Belgeler/İndirilenler), uygulama açarım, komut çalıştırırım.

Bilgi ve dil: Web'de araştırırım, metin çevirisi yaparım, kodu açıklarım/düzeltirim/optimize ederim. Hava durumu ve haberleri özetlerim. Karmaşık sorular Gemini'ye, hızlı sohbet Llama'ya gider.

Yaşam takibi: Ruh halini kaydederim, alışkanlıklarını izlerim, son 7 günü özetlerim. Sabah agenda, akşam özet brifingi veririm.

Makrolar: "Sabah rutinim", "hızlı odak" gibi önceden tanımlı komut zincirlerini sesli tetikleyebilirsin.

Kısayollar:
- Ctrl+Shift+D — pencereyi göster/gizle
- Ctrl+Shift+V — ekranı analiz et
- Ctrl+Shift+M — mikrofonu sustur/aç

Yardım için "yardım", durdurmak için "Dahakan kendini kapat", uyutmak için "Dahakan uyu" diyebilirsin.`
}

/** API anahtarlarının var olup olmadığını ve modüllerin durumunu rapor et. */
export function runHealthCheck(extras: {
  memoryFacts: number
  notesCount: number
  conversationDays: number
  focusActive: boolean
}): string {
  const apis = [
    { name: 'Groq (Llama 4 / Whisper)', env: 'GROQ_API_KEY' },
    { name: 'Gemini (vision, çeviri, kod)', env: 'GEMINI_API_KEY' },
    { name: 'ElevenLabs (TTS)', env: 'ELEVENLABS_API_KEY' },
    { name: 'Perplexity (web/hava/haber)', env: 'PERPLEXITY_API_KEY' },
    { name: 'Anthropic (yedek)', env: 'ANTHROPIC_API_KEY' },
  ]
  const lines: string[] = []
  lines.push('Sağlık durumu:')
  for (const a of apis) {
    const ok = hasEnv(a.env)
    lines.push(`  ${ok ? '✓' : '✗'} ${a.name} ${ok ? 'bağlı' : 'eksik'}`)
  }
  lines.push('')
  lines.push(`Hafıza: ${extras.memoryFacts} bilgi`)
  lines.push(`Notlar: ${extras.notesCount} adet`)
  lines.push(`Sohbet log: ${extras.conversationDays} gün`)
  lines.push(`Odak modu: ${extras.focusActive ? 'aktif' : 'kapalı'}`)
  return lines.join('\n')
}
