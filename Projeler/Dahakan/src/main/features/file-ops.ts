import { app } from 'electron'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve, normalize } from 'path'
import { homedir } from 'os'

const MAX_READ_BYTES = 80_000   // ~80KB metin okunabilir, fazlası truncate
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.html', '.css', '.scss', '.sh', '.bat', '.ps1',
  '.env.example', // .env'i ACILMAZ (gizli)
])

/** Dahakan'ın okuyabileceği dizinler. Kullanıcı dosyalarına sınırlı erişim. */
function allowedRoots(): string[] {
  const home = homedir()
  return [
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('userData'),
    join(home, 'Pictures'),
    // Antigravity proje klasörü erişilebilir olsun ki kod sorgulayabilsin
    join(home, 'Downloads', 'Antigravity'),
  ].map((p) => normalize(p))
}

function isInsideAllowed(targetAbs: string): boolean {
  const target = normalize(targetAbs).toLowerCase()
  return allowedRoots().some((root) => target === root.toLowerCase() || target.startsWith(root.toLowerCase() + '\\') || target.startsWith(root.toLowerCase() + '/'))
}

function resolveRelativeToHome(input: string): string {
  // "Masaüstü/" gibi Türkçe yolları normalize et
  let cleaned = input.trim().replace(/^["']|["']$/g, '')
  const trMap: Record<string, string> = {
    'masaüstü': app.getPath('desktop'),
    'masaustu': app.getPath('desktop'),
    'belgeler': app.getPath('documents'),
    'indirilenler': app.getPath('downloads'),
    'indirmeler': app.getPath('downloads'),
    'desktop': app.getPath('desktop'),
    'documents': app.getPath('documents'),
    'downloads': app.getPath('downloads'),
  }
  const firstSeg = cleaned.split(/[\\/]/)[0].toLowerCase()
  if (trMap[firstSeg]) {
    const rest = cleaned.slice(firstSeg.length).replace(/^[\\/]+/, '')
    cleaned = rest ? join(trMap[firstSeg], rest) : trMap[firstSeg]
  } else if (cleaned.startsWith('~')) {
    cleaned = join(homedir(), cleaned.slice(1).replace(/^[\\/]+/, ''))
  }
  return resolve(cleaned)
}

function isReadableExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  for (const ext of ALLOWED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

/** Bir metin dosyasını oku — güvenli dizinler ve uzantılar içinde. */
export function readTextFile(input: string): string {
  const abs = resolveRelativeToHome(input)
  if (!isInsideAllowed(abs)) {
    return `"${input}" Dahakan'ın erişebileceği dizinler içinde değil. (Masaüstü/Belgeler/İndirilenler/Antigravity)`
  }
  if (!existsSync(abs)) {
    return `Dosya bulunamadı: ${abs}`
  }
  const stat = statSync(abs)
  if (!stat.isFile()) {
    return `${abs} bir dosya değil (klasör mü?)`
  }
  if (!isReadableExtension(abs)) {
    return `Bu dosya türünü açmam doğru olmaz (sadece metin tabanlı dosyalar).`
  }
  if (stat.size > MAX_READ_BYTES * 4) {
    return `Dosya çok büyük (${Math.round(stat.size / 1024)} KB). 80KB üzerini açmıyorum.`
  }
  try {
    const raw = readFileSync(abs, 'utf-8')
    if (raw.length > MAX_READ_BYTES) {
      return raw.slice(0, MAX_READ_BYTES) + `\n\n[...${raw.length - MAX_READ_BYTES} karakter daha kesildi]`
    }
    return raw
  } catch (err) {
    return `Okuma hatası: ${(err as Error).message}`
  }
}

interface DirEntry {
  name: string
  isDir: boolean
  sizeKB?: number
  modified?: string
}

/** Bir dizinin içeriğini listele — gizli ve sistem dosyalarını atla. */
export function listDirectory(input: string, limit: number = 80): string {
  const abs = resolveRelativeToHome(input)
  if (!isInsideAllowed(abs)) {
    return `"${input}" Dahakan'ın erişebileceği dizinler içinde değil.`
  }
  if (!existsSync(abs)) {
    return `Klasör bulunamadı: ${abs}`
  }
  try {
    const items = readdirSync(abs)
      .filter((name) => !name.startsWith('.') && !name.startsWith('$'))
      .slice(0, limit)
    const entries: DirEntry[] = []
    for (const name of items) {
      try {
        const p = join(abs, name)
        const s = statSync(p)
        entries.push({
          name,
          isDir: s.isDirectory(),
          sizeKB: s.isFile() ? Math.round(s.size / 1024) : undefined,
          modified: s.mtime.toISOString().slice(0, 10),
        })
      } catch {
        // sembolik link kırıkları vb. — atla
      }
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'tr') : (a.isDir ? -1 : 1)))
    if (entries.length === 0) return `${abs} boş veya gösterilebilir öğe yok.`
    const lines = entries.map((e) => {
      const kind = e.isDir ? '📁' : '📄'
      const size = e.isDir ? '' : ` (${e.sizeKB} KB)`
      return `${kind} ${e.name}${size} — ${e.modified}`
    })
    return `${abs} içinde ${entries.length} öğe:\n${lines.join('\n')}`
  } catch (err) {
    return `Listeleme hatası: ${(err as Error).message}`
  }
}
