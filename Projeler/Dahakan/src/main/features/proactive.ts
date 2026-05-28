/** Proaktif check-in — settings.proactiveCheckInHours > 0 ise belirli aralıklarla
 *  Dahakan kullanıcıyı yoklayan bir mesaj atar. Mesaj rastgele bir konsey listeden seçilir
 *  ve TTS ile söylenir. Hedef: "gerçek arkadaş" hissi. */

const CHECK_IN_MESSAGES = [
  'Nasıl gidiyor? Bir şeye ihtiyacın var mı?',
  'Uzun zamandır konuşmadık, iyi misin?',
  'Şu an bir mola yapsan mantıklı olabilir, ne dersin?',
  'Bugün ruh halini kayıt etmeyi unutma — nasıl hissediyorsun?',
  'Bir şey aklında var mı, not alayım mı?',
  'Önemli bir şey üzerinde mi çalışıyorsun, yardımcı olabilir miyim?',
]

export interface ProactiveOptions {
  intervalHours: number   // 0 ise pasif
  onMessage: (text: string) => void  // tetiklendiğinde çağrılır
}

export class ProactiveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private currentInterval = 0
  private callback: (text: string) => void
  private lastTriggeredAt = 0

  constructor(opts: ProactiveOptions) {
    this.callback = opts.onMessage
    this.setIntervalHours(opts.intervalHours)
  }

  setIntervalHours(hours: number): void {
    this.currentInterval = Math.max(0, Math.round(hours))
    this.reschedule()
  }

  private reschedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.currentInterval <= 0) {
      console.log('[Dahakan Proactive] Devre dışı')
      return
    }
    // Rastgele jitter: %50-100 aralık
    const baseMs = this.currentInterval * 60 * 60 * 1000
    const jitterMs = Math.round(baseMs * (0.5 + Math.random() * 0.5))
    this.timer = setTimeout(() => {
      this.trigger()
      this.reschedule()
    }, jitterMs)
    console.log(`[Dahakan Proactive] Sonraki check-in ${Math.round(jitterMs / 60000)} dk sonra`)
  }

  private trigger(): void {
    const now = Date.now()
    if (now - this.lastTriggeredAt < 30 * 60 * 1000) {
      // Son 30 dk içinde zaten tetiklendiyse atla
      return
    }
    this.lastTriggeredAt = now
    const idx = Math.floor(Math.random() * CHECK_IN_MESSAGES.length)
    const msg = CHECK_IN_MESSAGES[idx]
    console.log('[Dahakan Proactive] Tetiklendi:', msg)
    try { this.callback(msg) } catch (err) {
      console.warn('[Dahakan Proactive] Callback hatası:', err)
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
