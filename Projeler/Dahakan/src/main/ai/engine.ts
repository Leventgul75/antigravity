import Groq from 'groq-sdk'
import { buildSystemPrompt, TOOL_DEFINITIONS } from './system-prompt'
import { executeTool, setMemory, setBriefingProvider, setMacroStore } from './tools'
import { Memory } from './memory'
import { ConversationLog } from '../features/conversation-log'
import { MacroStoreFile } from '../features/macros'
import { getEnv } from '../utils/env-loader'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

const MAX_HISTORY = 24
const MAX_TOOL_ROUNDS = 5
// Bu eşik aşıldığında eski yarıyı özetleyip memory.recentSummary'e yaz, history'yi son N'e kırp.
const SUMMARIZE_AT = 20
const KEEP_AFTER_SUMMARIZE = 10
// Bir kullanıcı mesajı bu eşikten uzun olursa "araştırma" sayılır ve Gemini'ye yönlendirilir.
const GEMINI_ROUTING_WORD_THRESHOLD = 18
const GEMINI_ROUTING_KEYWORDS = [
  'araştır', 'arastir', 'incele', 'detaylı', 'detayli', 'karşılaştır', 'karsilastir',
  'analiz', 'derinlemesine', 'rapor', 'özetle uzun', 'gemini',
]

// Tool-call destekli, Türkçe'de iyi performans gösteren Groq modelleri
// Sıralı denenir; 429 / rate limit / tool_use_failed halinde bir sonrakine düşer
// Her modelin ayrı TPD kotası olduğu için chain ile günde 4x daha fazla token kullanılır
const MODEL_FALLBACK_CHAIN = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'llama-3.3-70b-versatile',
]

// Gemini model for "research" routing — free tier 2.5-flash, ucuz + hızlı
const GEMINI_RESEARCH_MODEL = 'gemini-2.5-flash'

export class AIEngine {
  private client: Groq
  private conversationHistory: ChatMessage[] = []
  // Hangi model şu an primary olarak deneniyor (otomatik rotasyon ile değişir)
  private currentModelIndex = 0
  // Hangi modeller geçici olarak kullanılamaz (rate limit'ten sonra reset zamanı)
  private modelCooldownUntil: Map<string, number> = new Map()
  // Kalıcı hafıza — disk'te JSON, system prompt'a her turda inject edilir
  private memory: Memory
  // Günlük markdown log — her tur sonunda yazılır
  private log: ConversationLog
  // Komut makroları — Levent önceden tanımlar, sesli tetikler
  private macros: MacroStoreFile

  constructor() {
    const apiKey = getEnv('GROQ_API_KEY')
    this.client = new Groq({ apiKey })
    this.memory = new Memory()
    this.log = new ConversationLog()
    this.macros = new MacroStoreFile()
    setMemory(this.memory)
    setMacroStore(this.macros)
    setBriefingProvider({ generateDailyBriefing: (m, e) => this.generateDailyBriefing(m, e) })
    console.log('[Dahakan AI] Motor başlatıldı, modeller:', MODEL_FALLBACK_CHAIN.join(', '))
  }

  /** Bir mesajın tanımlı bir makroyu tetikleyip tetiklemediğini kontrol et. */
  findMatchingMacroSteps(message: string): string[] | null {
    const match = this.macros.findMatching(message)
    if (!match) return null
    console.log(`[Dahakan AI] Makro eşleşti: "${match.name}"`)
    return match.steps
  }

  /** Şu an kullanılabilir ilk modeli döndürür */
  private pickModel(): string {
    const now = Date.now()
    for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
      const m = MODEL_FALLBACK_CHAIN[i]
      const cd = this.modelCooldownUntil.get(m) || 0
      if (cd <= now) return m
    }
    // Hepsi cooldown'daysa, en yakın resetli olanı kullan
    let earliest = MODEL_FALLBACK_CHAIN[0]
    let earliestTime = Infinity
    for (const m of MODEL_FALLBACK_CHAIN) {
      const cd = this.modelCooldownUntil.get(m) || 0
      if (cd < earliestTime) { earliestTime = cd; earliest = m }
    }
    return earliest
  }

  /** 429 hatasını yakalayıp modeli cooldown'a alır, sonraki modele döner */
  private handleRateLimit(model: string, err: any): string | null {
    const msg = err?.message || ''
    // "try again in 4m34.5s" gibi süreleri parse et
    const m = msg.match(/try again in\s+(?:(\d+)m)?(?:([\d.]+)s)?/i)
    let waitMs = 60_000 // default 1 dk
    if (m) {
      const min = parseFloat(m[1] || '0')
      const sec = parseFloat(m[2] || '0')
      waitMs = (min * 60 + sec) * 1000 + 2000 // +2 sn buffer
    }
    const resetAt = Date.now() + waitMs
    this.modelCooldownUntil.set(model, resetAt)
    console.warn(`[Dahakan AI] ${model} rate limit doldu, ${Math.round(waitMs / 1000)} sn cooldown. Diğer modele geçiliyor.`)

    // Sonraki uygun modeli bul
    const next = MODEL_FALLBACK_CHAIN.find((mm) => (this.modelCooldownUntil.get(mm) || 0) <= Date.now())
    return next || null
  }

  private trimHistory(): void {
    if (this.conversationHistory.length > MAX_HISTORY) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_HISTORY)
    }
  }

  /** History büyüdüğünde eski kısmı özetle, memory.recentSummary'e yaz, history'yi kırp.
   *  Fire-and-forget — kullanıcı cevabının ardından arka planda çalışır. */
  private maybeSummarizeAsync(): void {
    if (this.conversationHistory.length < SUMMARIZE_AT) return
    const toSummarize = this.conversationHistory.slice(0, this.conversationHistory.length - KEEP_AFTER_SUMMARIZE)
    if (toSummarize.length === 0) return
    // History'yi hemen kırp ki sonraki turlarda büyümesin
    this.conversationHistory = this.conversationHistory.slice(-KEEP_AFTER_SUMMARIZE)
    // Arka planda çağır
    void this.summarizeMessages(toSummarize).then((summary) => {
      if (summary) {
        const prev = this.memory.getRecentSummary()
        const combined = prev
          ? `${prev}\n\n[Yeni:] ${summary}`.slice(-2000)
          : summary
        this.memory.setRecentSummary(combined)
        console.log('[Dahakan AI] Konuşma özetlendi, memory güncellendi')
      }
    }).catch((err) => {
      console.warn('[Dahakan AI] Özet üretilemedi:', err?.message || err)
    })
  }

  private async summarizeMessages(msgs: ChatMessage[]): Promise<string> {
    const transcript = msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? 'Levent' : 'Dahakan'}: ${m.content || ''}`)
      .join('\n')
    if (transcript.trim().length === 0) return ''
    const prompt = `Aşağıda Levent ile Dahakan arasındaki bir sohbet var. Bunu 4-6 kısa madde halinde özetle: ne konuşulduğu, Levent'in önemli verdiği bilgiler, kararlar, açık görevler. Sadece özeti yaz, başka bir şey yazma.

SOHBET:
${transcript}`
    const resp = await this.createCompletion({
      messages: [{ role: 'user', content: prompt }] as any,
      temperature: 0.3,
      max_tokens: 400,
    })
    return resp.choices?.[0]?.message?.content?.trim() || ''
  }

  private buildMessages(): ChatMessage[] {
    const systemContent = buildSystemPrompt({
      date: new Date(),
      memoryBlock: this.memory.serializeForPrompt(),
    })
    return [
      { role: 'system', content: systemContent },
      ...this.conversationHistory
    ]
  }

  /** Mesajın "araştırma/derin" sorgu olup olmadığını sezgiyle anla.
   *  Kullanıcı "gemini" derse veya araştırma sözleri + uzun cümle ise true. */
  private shouldRouteToGemini(message: string): boolean {
    const m = message.toLowerCase()
    if (m.includes('gemini')) return true
    const wordCount = m.split(/\s+/).filter((w) => w.length > 0).length
    if (wordCount < GEMINI_ROUTING_WORD_THRESHOLD) return false
    return GEMINI_ROUTING_KEYWORDS.some((k) => m.includes(k))
  }

  /** Gemini 2.5 Flash ile bir kerelik araştırma cevabı.
   *  Tool desteği yok — yalnızca text. Sonuç ana akışa metin olarak döner. */
  private async askGemini(message: string): Promise<string | null> {
    const apiKey = (() => {
      try { return getEnv('GEMINI_API_KEY') } catch { return '' }
    })()
    if (!apiKey) return null
    try {
      const { default: fetch } = await import('node-fetch')
      const systemContent = buildSystemPrompt({
        date: new Date(),
        memoryBlock: this.memory.serializeForPrompt(),
      })
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_RESEARCH_MODEL}:generateContent?key=${apiKey}`
      const body = {
        systemInstruction: { parts: [{ text: systemContent }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 800 },
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        console.warn('[Dahakan AI] Gemini routing 4xx/5xx:', resp.status)
        return null
      }
      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
      return text || null
    } catch (err) {
      console.warn('[Dahakan AI] Gemini routing istek hatası:', err)
      return null
    }
  }

  /** Zaman ve memory bazlı, kişiselleştirilmiş bir karşılama üret.
   *  Hata olursa basit bir fallback döner — kullanıcı asla sessiz başlangıç görmesin. */
  async generateGreeting(): Promise<string> {
    const hour = new Date().getHours()
    let timeOfDay = 'gün ortası'
    if (hour < 6) timeOfDay = 'gece geç saatler'
    else if (hour < 11) timeOfDay = 'sabah'
    else if (hour < 14) timeOfDay = 'öğle'
    else if (hour < 18) timeOfDay = 'öğleden sonra'
    else if (hour < 22) timeOfDay = 'akşam'
    else timeOfDay = 'gece'

    const memoryBlock = this.memory.serializeForPrompt()
    const prompt = `Sen Dahakan'sın. Şu an ${timeOfDay} (saat ${hour}:${String(new Date().getMinutes()).padStart(2, '0')}). Levent yeni uygulamayı açtı.

Aşağıdaki hafızanı kullanarak ona kısa, samimi bir karşılama yaz — 1-2 cümle, doğal Türkçe, hitap yok ("efendim/abi/kanka" YASAK). Saate uygun selam ver (günaydın/iyi akşamlar gibi), bildiğin önemli bir şey varsa ona doğal bir referans ver veya ne yapmak istediğini sor. Yapmacık olma, kısa kes.

${memoryBlock}

Karşılama mesajını sadece çıktı olarak yaz, açıklama yapma:`

    try {
      const resp = await this.createCompletion({
        messages: [{ role: 'user', content: prompt }] as any,
        temperature: 0.8,
        max_tokens: 120,
      })
      const text = resp.choices?.[0]?.message?.content?.trim() || ''
      return text || this.fallbackGreeting(timeOfDay)
    } catch (err) {
      console.warn('[Dahakan AI] Karşılama üretilemedi:', err)
      return this.fallbackGreeting(timeOfDay)
    }
  }

  private fallbackGreeting(timeOfDay: string): string {
    if (timeOfDay === 'sabah') return 'Günaydın. Bugün ne yapıyoruz?'
    if (timeOfDay === 'öğle') return 'Selam. Karın doyurdun mu, devam ediyor muyuz?'
    if (timeOfDay === 'akşam') return 'İyi akşamlar. Yorucu bir gün müydü?'
    if (timeOfDay === 'gece') return 'Gece çalışıyoruz demek. Nasıl yardım edebilirim?'
    return 'Buradayım, dinliyorum.'
  }

  /** Günlük brifing: sabah agenda, akşam özet. Mod yoksa saatten karar verilir. */
  async generateDailyBriefing(mode: 'sabah' | 'aksam' | 'auto' = 'auto', extraContext: string = ''): Promise<string> {
    const hour = new Date().getHours()
    let realMode: 'sabah' | 'aksam' = 'sabah'
    if (mode === 'auto') {
      realMode = hour >= 17 ? 'aksam' : 'sabah'
    } else {
      realMode = mode
    }
    const memoryBlock = this.memory.serializeForPrompt()
    const recentSummary = this.memory.getRecentSummary()

    const intro = realMode === 'sabah'
      ? `Şu an sabah/öğle, Levent yeni bir güne başlıyor.`
      : `Şu an akşam, Levent bir günü kapatıyor.`
    const focus = realMode === 'sabah'
      ? `BUGÜN için kısa bir agenda yaz — bildiğin şeyler ışığında 3-5 cümle. Yapacaklarını ve hatırlattıkların varsa onları öne çıkar. Yapmacık olma.`
      : `BUGÜN ne yapıldığının kısa özetini yaz — sohbet özetinden çıkar. Sonra varsa yarına bakacak bir not düş. 3-5 cümle, doğal konuşma dili.`

    const prompt = `Sen Dahakan'sın. ${intro}

${focus}

${memoryBlock}

${recentSummary ? `SOHBET ÖZETİ:\n${recentSummary}\n` : ''}
${extraContext ? `EK BAĞLAM:\n${extraContext}\n` : ''}

Markdown KULLANMA, hitap YOK ("efendim/abi/kanka" yasak), düz Türkçe konuşma dili. 3-5 cümle. Sadece brifingi yaz, açıklama yapma.`

    try {
      const resp = await this.createCompletion({
        messages: [{ role: 'user', content: prompt }] as any,
        temperature: 0.6,
        max_tokens: 400,
      })
      const text = resp.choices?.[0]?.message?.content?.trim() || ''
      return text || (realMode === 'sabah' ? 'Yeni güne hoş geldin. Bugün ne yapalım?' : 'Günü tamamladın. Yarın görüşürüz.')
    } catch (err) {
      console.warn('[Dahakan AI] Brifing üretilemedi:', err)
      return realMode === 'sabah'
        ? 'Yeni güne hoş geldin. Bugün ne yapalım?'
        : 'Günü tamamladın. Yarın görüşürüz.'
    }
  }

  /** Rate-limit + tool-format hatalarına dayanıklı tamamlama: cooldown'daki modeli atlar */
  private async createCompletion(params: any): Promise<any> {
    let lastErr: any = null
    const triedModels = new Set<string>()
    for (let attempt = 0; attempt < MODEL_FALLBACK_CHAIN.length * 2; attempt++) {
      const model = this.pickModel()
      if (triedModels.has(model)) break // tüm modeller denendi, döngüyü kır
      triedModels.add(model)
      try {
        console.log(`[Dahakan AI] Model deneniyor: ${model}`)
        return await this.client.chat.completions.create({ ...params, model })
      } catch (err: any) {
        lastErr = err
        const status = err?.status
        const code = err?.error?.code || err?.code
        // 429 (rate limit) → bu modeli cooldown'a al
        if (status === 429) {
          this.handleRateLimit(model, err)
          continue
        }
        // 400 + tool_use_failed → model tool çağrısını bozuk format yazdı, başka modele dön
        if (status === 400 && (code === 'tool_use_failed' || (err?.message || '').includes('tool'))) {
          console.warn(`[Dahakan AI] ${model} tool çağrısını bozdu, sonraki modele geçiliyor`)
          // Bu modeli kısa süreli cooldown'a al ki sonraki çağrıda da denenmesin
          this.modelCooldownUntil.set(model, Date.now() + 30_000)
          continue
        }
        // Diğer hatalar → fırlat
        throw err
      }
    }
    throw lastErr
  }

  async ask(message: string): Promise<string> {
    // Akıllı routing: araştırma sorularını Gemini'ye gönder, sonucu history'ye yaz, dön.
    if (this.shouldRouteToGemini(message)) {
      const geminiAnswer = await this.askGemini(message)
      if (geminiAnswer) {
        this.conversationHistory.push({ role: 'user', content: message })
        this.conversationHistory.push({ role: 'assistant', content: geminiAnswer })
        this.trimHistory()
        this.log.appendTurn('levent', message)
        this.log.appendTurn('dahakan', geminiAnswer)
        this.maybeSummarizeAsync()
        return geminiAnswer
      }
      // Gemini başarısız → Groq'a düş, sessiz geç
    }

    this.conversationHistory.push({ role: 'user', content: message })
    this.trimHistory()
    this.log.appendTurn('levent', message)

    try {
      let rounds = 0

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++
        const messages = this.buildMessages()

        const response = await this.createCompletion({
          messages: messages as any,
          tools: TOOL_DEFINITIONS as any,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 2048
        })

        const choice = response.choices[0]
        const assistantMessage = choice.message

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          // Add assistant message with tool calls to history
          this.conversationHistory.push({
            role: 'assistant',
            content: assistantMessage.content || null,
            tool_calls: assistantMessage.tool_calls
          })

          // Execute each tool call
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs: Record<string, any> = {}

            try {
              toolArgs = JSON.parse(toolCall.function.arguments)
            } catch {
              toolArgs = {}
            }

            console.log(`[Dahakan AI] Araç çağrısı: ${toolName}`, toolArgs)
            const toolResult = await executeTool(toolName, toolArgs)

            this.conversationHistory.push({
              role: 'tool',
              content: toolResult,
              tool_call_id: toolCall.id
            })
          }

          // Continue to get final response after tool execution
          continue
        }

        // No tool calls — we have a final text response
        const responseText = assistantMessage.content || ''
        this.conversationHistory.push({ role: 'assistant', content: responseText })
        this.trimHistory()
        this.log.appendTurn('dahakan', responseText)
        this.maybeSummarizeAsync()
        return responseText
      }

      // If we exhausted tool rounds, return a fallback
      const fallback = 'İsteğinizi yerine getirmeye çalıştım efendim, ancak çok fazla adım gerekti. Sonucu özetlememi ister misiniz?'
      this.conversationHistory.push({ role: 'assistant', content: fallback })
      return fallback
    } catch (error: any) {
      console.error('[Dahakan AI] Yanıt hatası:', error)
      const errorMsg = this.friendlyErrorMessage(error)
      this.conversationHistory.push({ role: 'assistant', content: errorMsg })
      return errorMsg
    }
  }

  /** Hatadan kullanıcı dostu, kısa Türkçe mesaj üret */
  private friendlyErrorMessage(error: any): string {
    const status = error?.status
    const msg = String(error?.message || '')
    if (status === 429) {
      // Süreyi mesajdan çıkarmaya çalış
      const m = msg.match(/try again in\s+(?:(\d+)m)?(?:([\d.]+)s)?/i)
      if (m) {
        const min = parseInt(m[1] || '0', 10)
        const sec = parseFloat(m[2] || '0')
        if (min > 0) return `Şu an konuşamam, günlük kotam doldu. Yaklaşık ${min} dakika sonra döneceğim.`
        return `Şu an konuşamam, kısa süre içinde tekrar dene (yaklaşık ${Math.ceil(sec)} saniye).`
      }
      return 'Şu an konuşamam, kısa süre içinde tekrar dene.'
    }
    if (status === 401 || status === 403) {
      return 'Yetki sorunu var. API anahtarımı kontrol et.'
    }
    if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
      return 'İnternete ulaşamıyorum. Bağlantını kontrol et.'
    }
    return 'Bir aksaklık oldu, biraz sonra tekrar dene.'
  }

  async askStream(message: string, onChunk: (chunk: string) => void): Promise<string> {
    // Akıllı routing — araştırma sorularında Gemini'ye git, cevabı chunk olarak fragmentle.
    if (this.shouldRouteToGemini(message)) {
      const geminiAnswer = await this.askGemini(message)
      if (geminiAnswer) {
        this.conversationHistory.push({ role: 'user', content: message })
        this.conversationHistory.push({ role: 'assistant', content: geminiAnswer })
        this.trimHistory()
        this.log.appendTurn('levent', message)
        this.log.appendTurn('dahakan', geminiAnswer)
        this.maybeSummarizeAsync()
        // Cevabı kelime kelime stream et — renderer'da progressively görünsün
        const words = geminiAnswer.split(/(\s+)/)
        for (const w of words) {
          onChunk(w)
        }
        return geminiAnswer
      }
      // Sessiz fallback — Groq'a düş
    }

    this.conversationHistory.push({ role: 'user', content: message })
    this.trimHistory()
    this.log.appendTurn('levent', message)

    try {
      let rounds = 0

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++
        const messages = this.buildMessages()

        // First, do a non-streaming call to check for tool calls
        const checkResponse = await this.createCompletion({
          messages: messages as any,
          tools: TOOL_DEFINITIONS as any,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 2048
        })

        const checkChoice = checkResponse.choices[0]
        const checkMessage = checkChoice.message

        if (checkMessage.tool_calls && checkMessage.tool_calls.length > 0) {
          // Handle tool calls
          this.conversationHistory.push({
            role: 'assistant',
            content: checkMessage.content || null,
            tool_calls: checkMessage.tool_calls
          })

          for (const toolCall of checkMessage.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs: Record<string, any> = {}

            try {
              toolArgs = JSON.parse(toolCall.function.arguments)
            } catch {
              toolArgs = {}
            }

            console.log(`[Dahakan AI Stream] Araç çağrısı: ${toolName}`, toolArgs)
            const toolResult = await executeTool(toolName, toolArgs)

            this.conversationHistory.push({
              role: 'tool',
              content: toolResult,
              tool_call_id: toolCall.id
            })
          }

          continue
        }

        // No tool calls — now stream the final response
        const streamMessages = this.buildMessages()

        const stream = await this.createCompletion({
          messages: streamMessages as any,
          temperature: 0.7,
          max_tokens: 2048,
          stream: true
        })

        let fullResponse = ''

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) {
            fullResponse += delta
            onChunk(delta)
          }
        }

        this.conversationHistory.push({ role: 'assistant', content: fullResponse })
        this.trimHistory()
        this.log.appendTurn('dahakan', fullResponse)
        this.maybeSummarizeAsync()
        return fullResponse
      }

      const fallback = 'İsteğinizi yerine getirmeye çalıştım efendim, ancak çok fazla adım gerekti.'
      onChunk(fallback)
      this.conversationHistory.push({ role: 'assistant', content: fallback })
      return fallback
    } catch (error: any) {
      console.error('[Dahakan AI Stream] Yanıt hatası:', error)
      const errorMsg = this.friendlyErrorMessage(error)
      onChunk(errorMsg)
      this.conversationHistory.push({ role: 'assistant', content: errorMsg })
      return errorMsg
    }
  }

  clearHistory(): void {
    this.conversationHistory = []
    console.log('[Dahakan AI] Konuşma geçmişi temizlendi')
  }
}
