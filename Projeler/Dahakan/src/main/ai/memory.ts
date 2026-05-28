import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface MemorySnapshot {
  userFacts: string[]
  recentSummary: string
  lastUpdated: string
  version: number
}

const SEED_FACTS = [
  'Kullanıcının adı Levent.',
  'E-posta: sarkoy@gmail.com.',
  'Yazılım/AI ürünleri geliştiriyor; Antigravity ekosisteminde 50+ proje var.',
  'Türkiye/İstanbul saat dilimi.',
  'Tercih: kısa, doğal Türkçe; abi/efendim/kanka gibi hitaplara karşı.',
]

const MAX_FACTS = 60

export class Memory {
  private filePath: string
  private snapshot: MemorySnapshot

  constructor() {
    this.filePath = join(app.getPath('userData'), 'dahakan-memory.json')
    this.snapshot = this.load()
  }

  private load(): MemorySnapshot {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as MemorySnapshot
        if (parsed && Array.isArray(parsed.userFacts)) {
          console.log(`[Dahakan Memory] Yüklendi: ${parsed.userFacts.length} bilgi, son güncelleme ${parsed.lastUpdated}`)
          return parsed
        }
      } catch (err) {
        console.warn('[Dahakan Memory] Dosya okunamadı, sıfırdan başlanıyor:', err)
      }
    }
    const fresh: MemorySnapshot = {
      userFacts: [...SEED_FACTS],
      recentSummary: '',
      lastUpdated: new Date().toISOString(),
      version: 1,
    }
    this.persist(fresh)
    console.log('[Dahakan Memory] Sıfırdan başlatıldı, seed bilgileri yazıldı:', this.filePath)
    return fresh
  }

  private persist(snap: MemorySnapshot): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(snap, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Dahakan Memory] Kaydedilemedi:', err)
    }
  }

  /** Yeni bir bilgi ekle. Aynı bilgi zaten varsa atla. En eskiyi kırp. */
  addFact(fact: string): boolean {
    const cleaned = fact.trim()
    if (cleaned.length === 0) return false
    const lower = cleaned.toLowerCase()
    if (this.snapshot.userFacts.some((f) => f.toLowerCase() === lower)) return false

    this.snapshot.userFacts.push(cleaned)
    if (this.snapshot.userFacts.length > MAX_FACTS) {
      // Seed bilgilerini koru, en eski user-eklenenleri kırp
      const seedCount = SEED_FACTS.length
      const overflow = this.snapshot.userFacts.length - MAX_FACTS
      this.snapshot.userFacts.splice(seedCount, overflow)
    }
    this.snapshot.lastUpdated = new Date().toISOString()
    this.persist(this.snapshot)
    console.log(`[Dahakan Memory] Bilgi eklendi: "${cleaned}"`)
    return true
  }

  /** Bir bilgiyi sil (içerik bazlı, partial match). */
  forgetFact(needle: string): number {
    const n = needle.toLowerCase().trim()
    if (n.length === 0) return 0
    const before = this.snapshot.userFacts.length
    this.snapshot.userFacts = this.snapshot.userFacts.filter((f) => !f.toLowerCase().includes(n))
    const removed = before - this.snapshot.userFacts.length
    if (removed > 0) {
      this.snapshot.lastUpdated = new Date().toISOString()
      this.persist(this.snapshot)
      console.log(`[Dahakan Memory] ${removed} bilgi silindi (eşleşen: "${needle}")`)
    }
    return removed
  }

  setRecentSummary(summary: string): void {
    this.snapshot.recentSummary = summary.trim()
    this.snapshot.lastUpdated = new Date().toISOString()
    this.persist(this.snapshot)
  }

  getFacts(): string[] {
    return [...this.snapshot.userFacts]
  }

  getRecentSummary(): string {
    return this.snapshot.recentSummary
  }

  /** System prompt'a enjekte edilecek hafıza özeti. */
  serializeForPrompt(): string {
    const parts: string[] = []
    if (this.snapshot.userFacts.length > 0) {
      parts.push('LEVENT HAKKINDA BİLİYORSUN:')
      this.snapshot.userFacts.forEach((f) => parts.push(`- ${f}`))
    }
    if (this.snapshot.recentSummary) {
      parts.push('')
      parts.push('SON KONUŞMALARIN ÖZETİ:')
      parts.push(this.snapshot.recentSummary)
    }
    return parts.join('\n')
  }

  clearAll(keepSeed = true): void {
    this.snapshot = {
      userFacts: keepSeed ? [...SEED_FACTS] : [],
      recentSummary: '',
      lastUpdated: new Date().toISOString(),
      version: 1,
    }
    this.persist(this.snapshot)
    console.log('[Dahakan Memory] Sıfırlandı')
  }
}
