import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface MacroDef {
  name: string
  trigger: string[]   // sesli tetikleyici kelimeler/cümleler
  steps: string[]     // sırayla çalıştırılacak doğal dil komutları
  description?: string
}

interface MacroStore {
  macros: MacroDef[]
  version: number
}

const SEED_MACROS: MacroDef[] = [
  {
    name: 'Sabah Rutini',
    trigger: ['sabah rutinim', 'sabah rutini başlat', 'günaydın rutini'],
    steps: [
      'Bana sabah brifingi ver — bugünün ajandasını ve hatırlattıklarımı söyle.',
      'Hangi uygulamada olduğumu kontrol et.',
    ],
    description: 'Günaydın selamı + agenda + aktif pencere.',
  },
  {
    name: 'Hızlı Odak',
    trigger: ['hızlı odak', 'çabuk pomodoro', 'odaklan başlat'],
    steps: [
      '25 dakikalık odaklanma modunu "çalışma" diye başlat.',
    ],
    description: '25 dk pomodoro.',
  },
]

const MAX_MACROS = 30

export class MacroStoreFile {
  private filePath: string
  private store: MacroStore

  constructor() {
    this.filePath = join(app.getPath('userData'), 'dahakan-macros.json')
    this.store = this.load()
  }

  private load(): MacroStore {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as MacroStore
        if (parsed && Array.isArray(parsed.macros)) {
          return parsed
        }
      } catch (err) {
        console.warn('[Dahakan Macros] Yükleme hatası, seed kullanılıyor:', err)
      }
    }
    const fresh: MacroStore = { macros: [...SEED_MACROS], version: 1 }
    this.persist(fresh)
    return fresh
  }

  private persist(s: MacroStore): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(s, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Dahakan Macros] Kaydedilemedi:', err)
    }
  }

  /** Sesli komutta makro tetikleyicisi var mı kontrol et — kelime/cümle eşleşmesi. */
  findMatching(speech: string): MacroDef | null {
    const norm = speech.toLowerCase().replace(/[\s\-_.,!?'"`]/g, '')
    for (const m of this.store.macros) {
      for (const t of m.trigger) {
        const tnorm = t.toLowerCase().replace(/[\s\-_.,!?'"`]/g, '')
        if (tnorm.length === 0) continue
        if (norm.includes(tnorm)) return m
      }
    }
    return null
  }

  list(): MacroDef[] {
    return [...this.store.macros]
  }

  add(macro: MacroDef): boolean {
    if (!macro.name || !macro.trigger || macro.trigger.length === 0 || !macro.steps || macro.steps.length === 0) {
      return false
    }
    if (this.store.macros.some((m) => m.name.toLowerCase() === macro.name.toLowerCase())) {
      // İsim çakışıyor — üstüne yaz
      this.store.macros = this.store.macros.filter((m) => m.name.toLowerCase() !== macro.name.toLowerCase())
    }
    this.store.macros.push(macro)
    if (this.store.macros.length > MAX_MACROS) {
      this.store.macros.shift()
    }
    this.persist(this.store)
    return true
  }

  remove(name: string): boolean {
    const before = this.store.macros.length
    this.store.macros = this.store.macros.filter((m) => m.name.toLowerCase() !== name.toLowerCase())
    if (this.store.macros.length !== before) {
      this.persist(this.store)
      return true
    }
    return false
  }
}

export function formatMacrosForAI(macros: MacroDef[]): string {
  if (macros.length === 0) return 'Hiç makro tanımlı değil.'
  return macros.map((m, i) => {
    return `${i + 1}. ${m.name}\n   Tetikleyiciler: ${m.trigger.join(', ')}\n   Adımlar: ${m.steps.join(' → ')}${m.description ? `\n   Açıklama: ${m.description}` : ''}`
  }).join('\n\n')
}
