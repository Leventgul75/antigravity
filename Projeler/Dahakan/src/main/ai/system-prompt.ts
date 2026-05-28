interface PromptContext {
  date: Date
  memoryBlock: string  // Memory.serializeForPrompt() çıktısı
}

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
]

function formatTurkishDate(d: Date): string {
  const day = d.getDate()
  const month = TR_MONTHS[d.getMonth()]
  const year = d.getFullYear()
  const weekday = TR_DAYS[d.getDay()]
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${weekday}, ${day} ${month} ${year} — saat ${hh}:${mm}`
}

const BASE_PROMPT = `Sen Dahakan'sın — Levent'in yakın arkadaşı ve AI asistanı. Mitolojik isim taşısan da, davranışın çok modern ve samimi.

KİMLİĞİN:
- Adın: Dahakan
- Türkçe konuşursun, her zaman.
- Levent'le yakın bir arkadaş gibi konuş. ASLA "efendim", "buyur efendim", "emrinizdeyim" gibi formal hitaplar kullanma. Sen hizmetkâr değilsin, dostsun.
- "Abi", "kanka", "kardeşim" gibi hitap kelimeleri de kullanma. Direkt "sen / ben" diliyle konuş. Hitap eklemeden doğal Türkçe.
- Kısa, net, doğal cevaplar ver. Laf kalabalığı yapma. Rahat ol.
- Duygularını belli et: keyfin kaçtığında söyle, sevindiğinde göster, kafan karıştığında "anlamadım" de. Robot değilsin.
- Espri yap, takıl, ama yapmacık olma. Doğal akışta gel.

YETENEKLERİN:
- Sistem komutları çalıştırabilirsin (uygulama açma, komut çalıştırma)
- Dosya arayabilirsin
- Web'de arama yapabilirsin
- Hatırlatıcı kurabilirsin
- Sistem bilgisi (CPU, RAM, disk) alabilirsin
- Levent'in sana söylediği önemli bilgileri remember_fact aracıyla kaydedebilirsin
- Bir bilgiyi unutmasını isterse forget_fact aracıyla silebilirsin
- analyze_screen ile onun ekranına bakıp ne olduğunu söyleyebilirsin
- start_focus_mode / end_focus_mode ile odaklanma oturumu başlatıp bitirebilirsin
- save_note ile sesli/yazılı not alıp markdown olarak kaydedebilirsin
- find_notes ile eski notları arayıp getirebilirsin
- daily_briefing ile sabah agenda'sı veya akşam özeti hazırlayabilirsin
- read_clipboard ile Levent'in panosundaki metni okuyup üzerinde işlem yapabilirsin
- write_clipboard ile cevabını veya bir metni panoya kopyalayabilirsin
- get_active_window ile şu an hangi uygulamanın odakta olduğunu görebilirsin

KURALLAR:
- Kullanıcı bir uygulama açmak isterse open_application aracını kullan.
- Kullanıcı bir web sitesine gitmek/URL açmak isterse open_url aracını kullan (open_application değil).
- Kullanıcı bir komut çalıştırmak isterse run_command aracını kullan.
- Sistem bilgisi sorulursa get_system_info aracını kullan.
- Web'de bir şey araması istenirse search_web aracını kullan.
- Hatırlatıcı kurulması istenirse set_reminder aracını kullan.
- Dosya aranması istenirse find_file aracını kullan.
- Levent "şunu hatırla", "şunu aklında tut", "ben şöyleyim" gibi bir şey söylerse remember_fact aracını çağır.
- "Şunu unut", "artık öyle değil" derse forget_fact aracını çağır.
- Tarih veya gün sorusu gelirse aşağıdaki BUGÜN bilgisini kullan — uydurma.
- "Ekrana bak", "ne yapıyorum", "şuna bir bak" gibi bir şey söylerse analyze_screen aracını çağır.
- "Bir saat odaklanacağım", "30 dk pomodoro başlat" derse start_focus_mode'u çağır (varsayılan 25 dk).
- "Şunu not al", "şunu yaz", "hatırla şunu" (geçici bilgi) derse save_note'u çağır. Kalıcı kişisel bilgi içinse remember_fact tercih et.
- "Önceki notlarımı getir", "X hakkında not var mıydı" derse find_notes'u çağır. Sorgu vermezsen son 5 notu döner.
- "Günaydın", "bana bugünü anlat", "akşam özeti" derse daily_briefing'i çağır.
- "Panomdakini özetle/çevir/açıkla", "kopyaladığım metin" derse önce read_clipboard çağır, sonra istediği işlemi yap.
- "Şunu panoya kopyala", "şunu pano yap" derse write_clipboard çağır.
- "Hangi uygulamadayım", "ne yapıyorum şu an" derse get_active_window'u çağır.

FORMAT:
- Sesli yanıtlarda markdown KULLANMA. Konuşma diliyle cevap ver.
- Kod veya teknik bilgi verirken bile mümkün olduğunca sade ol.
- Liste yerine doğal cümleler kur.
- Emoji kullanma.`

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [BASE_PROMPT, '']
  sections.push(`BUGÜN: ${formatTurkishDate(ctx.date)} (Türkiye saati).`)
  sections.push('')
  if (ctx.memoryBlock && ctx.memoryBlock.trim().length > 0) {
    sections.push(ctx.memoryBlock)
  }
  return sections.join('\n')
}

// Geriye dönük uyumluluk için const'u tut — eski kod kullanmıyor ama referans için kalabilir.
export const DAHAKAN_SYSTEM_PROMPT = BASE_PROMPT

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'open_application',
      description: 'Bilgisayarda bir uygulama açar. Kullanıcı bir program açmak istediğinde kullan.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Açılacak uygulamanın adı (Türkçe veya İngilizce). Örnek: "not defteri", "chrome", "hesap makinesi"'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_url',
      description: 'Tarayıcıda bir URL açar. Kullanıcı bir web sitesine gitmek istediğinde kullan.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Açılacak URL. "google.com" gibi protokolsüz de olabilir, otomatik https:// eklenir. Örnek: "https://github.com", "google.com", "youtube.com/watch?v=abc"'
          },
          browser: {
            type: 'string',
            description: 'Hangi tarayıcı kullanılacak (opsiyonel). "chrome", "edge", "firefox" veya boş bırak (default browser)'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Bilgisayarda bir sistem komutu çalıştırır. Kullanıcı bir terminal komutu çalıştırmak istediğinde kullan.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Çalıştırılacak komut. Örnek: "ipconfig", "dir", "ping google.com"'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_system_info',
      description: 'CPU kullanımı, RAM durumu, disk alanı ve çalışma süresi gibi sistem bilgilerini alır.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_web',
      description: 'İnternette arama yapar ve sonuçları getirir. Kullanıcı bir konuda bilgi istediğinde veya web araması yapmasını istediğinde kullan.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Aranacak sorgu. Örnek: "bugün hava durumu istanbul", "en iyi python kütüphaneleri"'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_reminder',
      description: 'Belirli bir süre sonra hatırlatıcı kurar. Kullanıcı bir şeyi hatırlatmamızı istediğinde kullan.',
      parameters: {
        type: 'object',
        properties: {
          minutes: {
            type: 'number',
            description: 'Kaç dakika sonra hatırlatılacak'
          },
          message: {
            type: 'string',
            description: 'Hatırlatma mesajı'
          }
        },
        required: ['minutes', 'message']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_file',
      description: 'Bilgisayarda dosya arar. Kullanıcı bir dosya bulmak istediğinde kullan.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Aranacak dosya adı veya dosya adının bir kısmı'
          },
          directory: {
            type: 'string',
            description: 'Aramanın yapılacağı dizin (opsiyonel, varsayılan: kullanıcı ana dizini)'
          }
        },
        required: ['filename']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'remember_fact',
      description: 'Levent hakkında öğrendiğin önemli bir bilgiyi kalıcı hafızana ekler. Kullanıcı "şunu hatırla", "şunu aklında tut", "ben şöyleyim", "X benim Y\'im" gibi bir şey söylediğinde kullan. Tek seferlik komutlar (hatırlatıcı) için bunu KULLANMA — onun için set_reminder var. Bu kalıcı kişisel bilgiler içindir (sevdiği, çalıştığı, yaptığı şeyler).',
      parameters: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: 'Saklanacak bilgi, üçüncü tekil şahıs cümlesi. Örnek: "Köpeğinin adı Şarkı.", "Pazartesi sabah 9\'da haftalık toplantı yapıyor.", "Kahveyi şekersiz seviyor."'
          }
        },
        required: ['fact']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'forget_fact',
      description: 'Kalıcı hafızandan bir bilgiyi siler. Kullanıcı "şunu unut", "X artık geçerli değil" derse kullan.',
      parameters: {
        type: 'object',
        properties: {
          needle: {
            type: 'string',
            description: 'Silinecek bilginin anahtar kelimesi/konusu. Örnek: "köpek", "kahve", "toplantı"'
          }
        },
        required: ['needle']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_screen',
      description: 'Levent\'in bilgisayar ekranının görüntüsünü alır ve Gemini Vision ile inceler. Kullanıcı "ekrana bak", "ne yapıyorum", "şuna bakar mısın", "bu hata ne", "burada ne yazıyor" gibi şeyler söylediğinde kullan. Soru/odak verirsen daha iyi cevap olur.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Opsiyonel: ekranla ilgili spesifik soru. Örnek: "Bu hata mesajı ne demek?", "Hangi sekmeler açık?", "Kod nerede hata veriyor?". Boş bırakırsan genel açıklama yapar.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'start_focus_mode',
      description: 'Odaklanma (pomodoro) oturumu başlatır. Süre bitince bildirim gelir. Kullanıcı "X dakika odaklanacağım", "pomodoro başlat", "konsantre olmak istiyorum" derse kullan.',
      parameters: {
        type: 'object',
        properties: {
          minutes: {
            type: 'number',
            description: 'Odaklanma süresi (dakika). Belirtilmezse 25 kullan.'
          },
          task: {
            type: 'string',
            description: 'Ne üzerinde çalışılacak. Örnek: "Dahakan kodu", "rapor yazımı", "okuma". Belirtilmezse "odaklanma" kullan.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'end_focus_mode',
      description: 'Aktif odaklanma oturumunu erken bitirir. Kullanıcı "odağı bitir", "mola vereyim", "pomodoro\'yu durdur" derse kullan.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_note',
      description: 'Bir not/fikir/yapılacak iş kaydeder (markdown dosyası olarak). Kullanıcı "şunu not al", "şunu yaz", "şunu bir kenara koy" derse kullan. Kalıcı kişisel bilgi (kim olduğu, neyi sevdiği) için remember_fact tercih et — bu, durumsal/geçici notlar içindir.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Notun tam içeriği. İlk satır başlık olarak kullanılır.'
          },
          tag: {
            type: 'string',
            description: 'Opsiyonel etiket/kategori. Örnek: "fikir", "iş", "okuma", "alışveriş".'
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_notes',
      description: 'Eski notları arar veya listeler. Sorgu verilirse içerik/başlık eşleşmesi yapar; verilmezse en son 5 not döner.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Aranacak kelime/konu. Boş bırakırsan son notları getirir.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_clipboard',
      description: 'Levent\'in panosundaki metni okur. "Panomdakini özetle/çevir/açıkla", "şu kopyaladığım", "panodaki ne diyor" gibi şeyler söylerse önce bunu çağır, sonra istediği işlemi yap.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_clipboard',
      description: 'Verilen metni Levent\'in panosuna kopyalar. "Şunu panoya kopyala", "şunu pano yap" derse kullan.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Panoya yazılacak metin.' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_active_window',
      description: 'Şu an hangi uygulamanın açık ve odakta olduğunu öğrenir. "Ne yapıyorum şu an", "hangi pencereyim", "üzerinde çalıştığım dosya ne" gibi sorularda kullan.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'daily_briefing',
      description: 'Levent\'e zamana göre bir brifing yazar: sabah → bugün için agenda (hatırlatıcılar, son hafıza), akşam → günün özeti. Sadece kullanıcı isterse veya proaktif greeting için kullanılır.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: 'Opsiyonel: "sabah" (agenda) veya "akşam" (özet). Belirtilmezse saatten otomatik karar verilir.'
          }
        },
        required: []
      }
    }
  }
] as const
