import { Notification } from 'electron'

interface FocusSession {
  task: string
  startedAt: number
  endsAt: number
  durationMin: number
  timer: ReturnType<typeof setTimeout>
}

export class FocusMode {
  private active: FocusSession | null = null
  private onStateChange: (active: boolean, task: string) => void

  constructor(onStateChange: (active: boolean, task: string) => void) {
    this.onStateChange = onStateChange
  }

  start(durationMin: number, task: string): void {
    // Önce eski oturumu temizle
    if (this.active) {
      clearTimeout(this.active.timer)
      this.active = null
    }
    const durationMs = Math.max(1, durationMin) * 60 * 1000
    const startedAt = Date.now()
    const endsAt = startedAt + durationMs

    const timer = setTimeout(() => {
      const ended = this.active
      this.active = null
      if (ended) {
        new Notification({
          title: 'Dahakan — Odaklanma Tamam',
          body: `${ended.durationMin} dk "${ended.task}" oturumu bitti. Mola zamanı.`,
          silent: false,
        }).show()
      }
      this.onStateChange(false, '')
      console.log('[Dahakan Focus] Süre doldu, oturum bitti')
    }, durationMs)

    this.active = { task, startedAt, endsAt, durationMin, timer }
    this.onStateChange(true, task)
    console.log(`[Dahakan Focus] Başladı: ${durationMin} dk "${task}"`)
  }

  /** Returns true if a session was actually stopped. */
  stop(): boolean {
    if (!this.active) return false
    clearTimeout(this.active.timer)
    this.active = null
    this.onStateChange(false, '')
    console.log('[Dahakan Focus] Erken durduruldu')
    return true
  }

  isActive(): boolean {
    return this.active !== null
  }

  status(): { active: boolean; task?: string; remainingMin?: number } {
    if (!this.active) return { active: false }
    const remaining = Math.max(0, Math.ceil((this.active.endsAt - Date.now()) / 60000))
    return { active: true, task: this.active.task, remainingMin: remaining }
  }

  dispose(): void {
    if (this.active) clearTimeout(this.active.timer)
    this.active = null
  }
}
