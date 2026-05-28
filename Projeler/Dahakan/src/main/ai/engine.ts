import Groq from 'groq-sdk'
import { buildSystemPrompt, TOOL_DEFINITIONS } from './system-prompt'
import { executeTool, setMemory } from './tools'
import { Memory } from './memory'
import { getEnv } from '../utils/env-loader'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 5

// Tool-call destekli, Türkçe'de iyi performans gösteren Groq modelleri
// Sıralı denenir; 429 / rate limit / tool_use_failed halinde bir sonrakine düşer
// Her modelin ayrı TPD kotası olduğu için chain ile günde 4x daha fazla token kullanılır
const MODEL_FALLBACK_CHAIN = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'llama-3.3-70b-versatile',
]

export class AIEngine {
  private client: Groq
  private conversationHistory: ChatMessage[] = []
  // Hangi model şu an primary olarak deneniyor (otomatik rotasyon ile değişir)
  private currentModelIndex = 0
  // Hangi modeller geçici olarak kullanılamaz (rate limit'ten sonra reset zamanı)
  private modelCooldownUntil: Map<string, number> = new Map()
  // Kalıcı hafıza — disk'te JSON, system prompt'a her turda inject edilir
  private memory: Memory

  constructor() {
    const apiKey = getEnv('GROQ_API_KEY')
    this.client = new Groq({ apiKey })
    this.memory = new Memory()
    setMemory(this.memory)
    console.log('[Dahakan AI] Motor başlatıldı, modeller:', MODEL_FALLBACK_CHAIN.join(', '))
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
    this.conversationHistory.push({ role: 'user', content: message })
    this.trimHistory()

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
    this.conversationHistory.push({ role: 'user', content: message })
    this.trimHistory()

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
