import { getEnv } from '../utils/env-loader'

const GEMINI_MODEL = 'gemini-2.5-flash'

async function geminiText(prompt: string, maxTokens: number = 600): Promise<string> {
  const apiKey = (() => {
    try { return getEnv('GEMINI_API_KEY') } catch { return '' }
  })()
  if (!apiKey) return ''
  try {
    const { default: fetch } = await import('node-fetch')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      console.warn('[Dahakan Language] Gemini hatası:', resp.status)
      return ''
    }
    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  } catch (err) {
    console.warn('[Dahakan Language] istek hatası:', err)
    return ''
  }
}

const LANG_NAMES: Record<string, string> = {
  tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca',
  es: 'İspanyolca', it: 'İtalyanca', ar: 'Arapça', ru: 'Rusça',
  zh: 'Çince', ja: 'Japonca', ko: 'Korece', pt: 'Portekizce',
  nl: 'Felemenkçe', pl: 'Lehçe',
}

function normalizeLang(input: string): string {
  const l = input.toLowerCase().trim()
  // Türkçe karşılıklar
  const tr2code: Record<string, string> = {
    'türkçe': 'tr', 'turkce': 'tr', 'turkish': 'tr',
    'ingilizce': 'en', 'english': 'en', 'eng': 'en',
    'almanca': 'de', 'german': 'de', 'deutsch': 'de',
    'fransızca': 'fr', 'fransizca': 'fr', 'french': 'fr',
    'ispanyolca': 'es', 'spanish': 'es', 'español': 'es',
    'italyanca': 'it', 'italian': 'it',
    'arapça': 'ar', 'arapca': 'ar', 'arabic': 'ar',
    'rusça': 'ru', 'rusca': 'ru', 'russian': 'ru',
    'çince': 'zh', 'cince': 'zh', 'chinese': 'zh',
    'japonca': 'ja', 'japanese': 'ja',
    'korece': 'ko', 'korean': 'ko',
    'portekizce': 'pt', 'portuguese': 'pt',
    'felemenkçe': 'nl', 'felemenkce': 'nl', 'dutch': 'nl',
    'lehçe': 'pl', 'lehce': 'pl', 'polish': 'pl',
  }
  return tr2code[l] || (l.length === 2 ? l : 'en')
}

export async function translateText(text: string, targetLang: string): Promise<string> {
  const cleaned = text.trim()
  if (cleaned.length === 0) return 'Çevrilecek metin boş.'
  const code = normalizeLang(targetLang || 'en')
  const targetName = LANG_NAMES[code] || code

  const prompt = `Aşağıdaki metni ${targetName} diline doğal ve akıcı şekilde çevir. Sadece çeviriyi döndür, hiçbir açıklama yapma, başlık koyma. Argo varsa dilin karşılığını kullan, kelime kelime yapma.

METİN:
${cleaned}`

  const out = await geminiText(prompt, 800)
  if (!out) return 'Çeviri yapılamadı (Gemini bağlantı sorunu olabilir).'
  return out
}

export type CodeMode = 'explain' | 'fix' | 'optimize' | 'review'

export async function analyzeCode(code: string, mode: CodeMode = 'explain', extraQuestion?: string): Promise<string> {
  const cleaned = code.trim()
  if (cleaned.length === 0) return 'Analiz edilecek kod boş.'
  const modePrompt: Record<CodeMode, string> = {
    explain: 'Bu kodu kısa, doğal Türkçe ile anlat. Ne yapıyor, hangi parçalar kritik, dikkat çeken bir şey var mı.',
    fix: 'Bu kodda hata varsa bul ve nasıl düzelteceğini söyle. Sadece düzeltilmiş kodu DEĞIL, neyi neden değiştirdiğini de söyle.',
    optimize: 'Bu kodu performans ve okunabilirlik açısından nasıl iyileştirebileceğini söyle. Önerilerini somut ve uygulanabilir tut.',
    review: 'Bu kodu kısa bir code review gibi değerlendir: iyi yanlar, dikkat edilmesi gerekenler, riskler.',
  }
  const extra = extraQuestion ? `\n\nLevent ayrıca şunu sordu: "${extraQuestion}"` : ''
  const prompt = `${modePrompt[mode]}${extra}

Cevabını Markdown KULLANMADAN, doğal konuşma diliyle yaz — sesli okunacak. Kod örneği vereceksen \`\`\`backtick blokları KULLANMA, satır içinde kısaca tarif et. Çok uzun yazma.

KOD:
${cleaned}`

  const out = await geminiText(prompt, 900)
  if (!out) return 'Kodu analiz edemedim (Gemini bağlantı sorunu olabilir).'
  return out
}
