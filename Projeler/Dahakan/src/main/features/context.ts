import { clipboard } from 'electron'
import { spawn } from 'child_process'

const MAX_CLIPBOARD_RETURN = 4000  // AI'a yollanacak max karakter

export function readClipboard(): string {
  try {
    const text = clipboard.readText() || ''
    if (text.length === 0) {
      return ''
    }
    if (text.length > MAX_CLIPBOARD_RETURN) {
      return text.slice(0, MAX_CLIPBOARD_RETURN) + `\n\n[...${text.length - MAX_CLIPBOARD_RETURN} karakter daha kesildi]`
    }
    return text
  } catch (err) {
    console.error('[Dahakan Context] Clipboard okuma hatası:', err)
    return ''
  }
}

export function writeClipboard(text: string): boolean {
  try {
    clipboard.writeText(text)
    return true
  } catch (err) {
    console.error('[Dahakan Context] Clipboard yazma hatası:', err)
    return false
  }
}

interface ActiveWindowInfo {
  title: string
  processName: string
}

/** Windows'ta foreground window'un başlığını ve process adını al.
 *  PowerShell + Win32 GetForegroundWindow + GetWindowThreadProcessId.
 *  Spawn ile çalışır, ~150-300ms latency. */
export function getActiveWindow(): Promise<ActiveWindowInfo | null> {
  if (process.platform !== 'win32') {
    return Promise.resolve(null)
  }
  return new Promise<ActiveWindowInfo | null>((resolve) => {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class Dh_Win {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@ 2>$null
$h = [Dh_Win]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[Dh_Win]::GetWindowText($h, $sb, 512) | Out-Null
$title = $sb.ToString()
$pid_out = 0
[Dh_Win]::GetWindowThreadProcessId($h, [ref]$pid_out) | Out-Null
$pname = ""
try { $pname = (Get-Process -Id $pid_out -ErrorAction Stop).ProcessName } catch {}
"$title|$pname"
`.trim()
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    })
    let stdout = ''
    let done = false
    const finish = (result: ActiveWindowInfo | null) => {
      if (done) return
      done = true
      try { proc.kill() } catch {}
      resolve(result)
    }
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8') })
    proc.on('error', () => finish(null))
    proc.on('close', () => {
      const trimmed = stdout.trim()
      if (!trimmed) { finish(null); return }
      const [title, processName] = trimmed.split('|')
      finish({ title: (title || '').trim(), processName: (processName || '').trim() })
    })
    setTimeout(() => finish(null), 3000)
  })
}

export function formatActiveWindowForAI(info: ActiveWindowInfo | null): string {
  if (!info) return 'Aktif pencere algılanamadı.'
  const t = info.title || '(başlıksız)'
  const p = info.processName || '(bilinmeyen uygulama)'
  return `Şu an açık ve odakta: "${t}" — uygulama: ${p}`
}
