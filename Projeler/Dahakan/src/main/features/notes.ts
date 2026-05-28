import { app } from 'electron'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

interface NoteEntry {
  file: string
  title: string
  tag?: string
  createdAt: string
  preview: string
}

const NOTES_DIR_NAME = 'notes'

function notesDir(): string {
  const dir = join(app.getPath('userData'), NOTES_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'not'
}

/** Yeni not yaz. Başlık verilmezse ilk satırdan üret. Tag opsiyonel. */
export function saveNote(content: string, tag?: string): string {
  const cleaned = content.trim()
  if (cleaned.length === 0) {
    return 'Boş içerikli not kaydetmiyorum.'
  }
  const firstLine = cleaned.split(/\n/)[0].slice(0, 80)
  const ts = new Date()
  const isoDate = ts.toISOString().slice(0, 10) // YYYY-MM-DD
  const timeShort = ts.toTimeString().slice(0, 5).replace(':', '') // HHMM
  const slug = slugify(firstLine)
  const fileName = `${isoDate}-${timeShort}-${slug}.md`
  const filePath = join(notesDir(), fileName)

  const frontmatter = [
    '---',
    `title: ${firstLine.replace(/"/g, "'")}`,
    `tag: ${tag || ''}`,
    `created: ${ts.toISOString()}`,
    '---',
    '',
  ].join('\n')
  try {
    writeFileSync(filePath, frontmatter + cleaned, 'utf-8')
    console.log(`[Dahakan Notes] Yazıldı: ${fileName}`)
    return `Not kaydedildi: "${firstLine}". Dosya: ${fileName}`
  } catch (err) {
    console.error('[Dahakan Notes] Yazma hatası:', err)
    return `Notu kaydedemedim: ${(err as Error).message}`
  }
}

function parseNote(filePath: string, fileName: string): NoteEntry | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/)
    let title = fileName.replace(/\.md$/, '')
    let tag: string | undefined
    let createdAt = ''
    let body = raw
    if (fmMatch) {
      const fm = fmMatch[1]
      const titleM = fm.match(/title:\s*(.+)/)
      const tagM = fm.match(/tag:\s*(.+)/)
      const createdM = fm.match(/created:\s*(.+)/)
      if (titleM) title = titleM[1].trim()
      if (tagM && tagM[1].trim().length > 0) tag = tagM[1].trim()
      if (createdM) createdAt = createdM[1].trim()
      body = raw.slice(fmMatch[0].length)
    }
    const preview = body.replace(/\s+/g, ' ').trim().slice(0, 200)
    return { file: fileName, title, tag, createdAt, preview }
  } catch (err) {
    console.warn('[Dahakan Notes] Okuma hatası:', fileName, err)
    return null
  }
}

/** Tüm notları metaverisi ile döndürür, en yeniden eskiye. */
export function listNotes(limit: number = 20): NoteEntry[] {
  const dir = notesDir()
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  const entries: NoteEntry[] = []
  for (const f of files) {
    const parsed = parseNote(join(dir, f), f)
    if (parsed) entries.push(parsed)
  }
  // ISO created tarihine göre tersten sırala; yoksa dosya adına göre
  entries.sort((a, b) => (b.createdAt || b.file).localeCompare(a.createdAt || a.file))
  return entries.slice(0, limit)
}

/** Notlarda anahtar kelime ara — başlık + içerikte case-insensitive. */
export function findNotes(query: string, limit: number = 5): NoteEntry[] {
  const q = query.toLowerCase().trim()
  if (q.length === 0) return []
  const all = listNotes(200)
  const matches = all.filter((n) =>
    n.title.toLowerCase().includes(q) ||
    (n.tag && n.tag.toLowerCase().includes(q)) ||
    n.preview.toLowerCase().includes(q)
  )
  return matches.slice(0, limit)
}

/** Tek bir notun tam içeriğini döndür. */
export function readNoteByFile(file: string): string | null {
  const dir = notesDir()
  const filePath = join(dir, file)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** AI tool çağrıları için Türkçe formatlı liste metni. */
export function formatNotesForAI(notes: NoteEntry[]): string {
  if (notes.length === 0) return 'Hiç not bulunamadı.'
  return notes.map((n, i) => {
    const date = n.createdAt ? new Date(n.createdAt).toLocaleString('tr-TR', { hour12: false }) : ''
    const tag = n.tag ? ` [${n.tag}]` : ''
    return `${i + 1}. ${n.title}${tag}\n   ${date}\n   ${n.preview}${n.preview.length >= 200 ? '...' : ''}`
  }).join('\n\n')
}
