import { desktopCapturer, screen } from 'electron'
import { getEnv } from '../utils/env-loader'

const GEMINI_VISION_MODEL = 'gemini-2.5-flash'

/** Ana ekranın PNG base64 thumbnail'ını döndürür. Boyut çözünürlük × scale. */
async function captureScreen(): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const primary = screen.getPrimaryDisplay()
    const { width, height } = primary.size
    // Gemini için yeterli, 1080p'yi geçmeyen bir thumbnail — pahalı ve gereksiz büyük olmasın
    const scale = Math.min(1, 1280 / width)
    const thumbWidth = Math.round(width * scale)
    const thumbHeight = Math.round(height * scale)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight },
    })

    if (sources.length === 0) {
      console.warn('[Dahakan Vision] Ekran kaynağı bulunamadı')
      return null
    }

    // Ana ekran genelde ilk source — birden fazla varsa display_id ile eşle
    const primarySource = sources.find((s) => s.display_id === String(primary.id)) || sources[0]
    const pngBuffer = primarySource.thumbnail.toPNG()
    return {
      base64: pngBuffer.toString('base64'),
      mimeType: 'image/png',
    }
  } catch (err) {
    console.error('[Dahakan Vision] Ekran yakalama hatası:', err)
    return null
  }
}

/** Verilen prompt'la Gemini Vision'a ekran görüntüsünü gönder. */
export async function analyzeScreen(question?: string): Promise<string> {
  const apiKey = (() => {
    try { return getEnv('GEMINI_API_KEY') } catch { return '' }
  })()
  if (!apiKey) {
    return 'GEMINI_API_KEY tanımlı değil, ekran analizi yapılamaz.'
  }

  const shot = await captureScreen()
  if (!shot) {
    return 'Ekranı yakalayamadım.'
  }

  const prompt = (question && question.trim().length > 0)
    ? `Sen Levent'in ekranını görüyorsun. Sorusu: "${question.trim()}"\n\nKısa, doğal Türkçe ile cevap ver. Konuşma dili kullan, liste/markdown KULLANMA. Gerekirse "şu pencerede", "sol üstte" gibi konum belirt.`
    : `Sen Levent'in ekranını görüyorsun. Ekranda ne olduğunu kısaca, doğal Türkçe ile anlat: hangi uygulama açık, ne yapıyor, dikkat çeken bir şey var mı. 2-3 cümle yeter. Markdown/liste KULLANMA.`

  try {
    const { default: fetch } = await import('node-fetch')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: shot.mimeType, data: shot.base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 400,
      },
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      console.error('[Dahakan Vision] Gemini hatası:', resp.status, errText)
      return `Ekranı analiz edemedim (HTTP ${resp.status}).`
    }
    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
    if (!text) {
      return 'Ekranı gördüm ama anlamlı bir şey üretemedim.'
    }
    return text
  } catch (err) {
    console.error('[Dahakan Vision] İstek hatası:', err)
    return 'Ekran analizinde bağlantı sorunu oldu.'
  }
}
