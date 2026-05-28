import { Notification } from 'electron'

type Recurrence = 'once' | 'daily' | 'weekly'

interface Reminder {
  id: string
  time: number
  message: string
  recurrence: Recurrence
  timeout: ReturnType<typeof setTimeout>
}

export class ReminderManager {
  private reminders: Reminder[] = []
  private onReminder: (message: string) => void

  constructor(onReminder: (message: string) => void) {
    this.onReminder = onReminder
  }

  addReminder(minutes: number, message: string): string {
    return this.scheduleReminder({ minutes, message, recurrence: 'once' })
  }

  /** Recurring (her gün/her hafta) hatırlatıcı. minutes = ilk tetikleme süresi. */
  addRecurringReminder(minutes: number, message: string, recurrence: Recurrence): string {
    return this.scheduleReminder({ minutes, message, recurrence })
  }

  private scheduleReminder(opts: { minutes: number; message: string; recurrence: Recurrence }): string {
    const id = `reminder-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    const delayMs = Math.max(0, opts.minutes) * 60 * 1000
    const triggerTime = Date.now() + delayMs

    const timeout = setTimeout(() => {
      this.triggerReminder(id, opts.message)
    }, delayMs)

    this.reminders.push({
      id,
      time: triggerTime,
      message: opts.message,
      recurrence: opts.recurrence,
      timeout
    })

    const recLabel = opts.recurrence === 'daily' ? ' (her gün)' : opts.recurrence === 'weekly' ? ' (her hafta)' : ''
    console.log(`[Dahakan Hatırlatıcı] Kuruldu: "${opts.message}"${recLabel} — ${opts.minutes} dakika sonra`)
    return id
  }

  private triggerReminder(id: string, message: string): void {
    // Show Electron notification
    const notification = new Notification({
      title: 'Dahakan — Hatırlatma',
      body: message,
      icon: undefined,
      silent: false
    })
    notification.show()

    // Call the callback
    this.onReminder(message)

    // Recurring ise yeniden zamanla
    const r = this.reminders.find((x) => x.id === id)
    if (r && r.recurrence !== 'once') {
      const nextMs = r.recurrence === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
      r.time = Date.now() + nextMs
      r.timeout = setTimeout(() => this.triggerReminder(id, message), nextMs)
      console.log(`[Dahakan Hatırlatıcı] Recurring yeniden zamanlandı: "${message}" — ${r.recurrence}`)
    } else {
      this.reminders = this.reminders.filter(r => r.id !== id)
    }
    console.log(`[Dahakan Hatırlatıcı] Tetiklendi: "${message}"`)
  }

  cancelReminder(id: string): boolean {
    const index = this.reminders.findIndex(r => r.id === id)
    if (index === -1) return false

    clearTimeout(this.reminders[index].timeout)
    this.reminders.splice(index, 1)
    console.log(`[Dahakan Hatırlatıcı] İptal edildi: ${id}`)
    return true
  }

  getActiveReminders(): Array<{ id: string; message: string; remainingMinutes: number }> {
    const now = Date.now()
    return this.reminders.map(r => ({
      id: r.id,
      message: r.message,
      remainingMinutes: Math.max(0, Math.round((r.time - now) / 60000))
    }))
  }

  dispose(): void {
    for (const reminder of this.reminders) {
      clearTimeout(reminder.timeout)
    }
    this.reminders = []
    console.log('[Dahakan Hatırlatıcı] Tüm hatırlatıcılar temizlendi')
  }
}
