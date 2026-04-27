# LinkedIn Text Paylaşım

> n8n'den Antigravity'ye taşınan LinkedIn metin + görsel paylaşım otomasyon projesi.
> İki ayrı n8n workflow'u tek bir Python servisinde birleştirildi.

## 🚀 Ne Yapar?

Haftada iki gün **Diageo** odağında LinkedIn postu otomatik olarak üretir ve paylaşır:

| Gün | Saat | İçerik | Format |
|-----|------|--------|--------|
| **Çarşamba** | 08:00 (TR) | Diageo Türkiye hakkındaki olumlu haberler | 5 Maddelik Özet + Görsel |
| **Pazar** | 08:00 (TR) | Diageo hakkındaki global olumlu haberler | 5 Maddelik Özet + Görsel |

## ⚙️ Pipeline (Her İki Workflow İçin Aynı)

```
Schedule Trigger
  → Perplexity API (Güncel AI haberleri/tips araştır)
  → GPT-4.1 (LinkedIn postu yaz)
  → GPT-4.1-mini (Görsel prompt üret)
  → Gemini (Görsel üret)
  → LinkedIn API (Metin + görsel paylaş)
  → Notion (Log yaz)
```

## 📁 Dosya Yapısı

```
LinkedIn_Text_Paylasim/
├── main.py               → Orkestratör (schedule + iki workflow)
├── config.py              → Fail-fast env doğrulama
├── logger.py              → Standart loglama
├── core/
│   ├── researcher.py      → Perplexity API (AI haberleri araştırması)
│   ├── post_writer.py     → GPT-4.1 (post yazma)
│   ├── image_generator.py → GPT-4.1-mini (prompt) + Gemini (görsel)
│   ├── linkedin_publisher.py → LinkedIn API (paylaşım)
│   └── notion_logger.py   → Notion loglama + duplicate kontrol
├── n8n_workflows/         → Orijinal n8n JSON dosyaları (referans)
├── requirements.txt       → Pinned dependencies
├── Procfile               → Railway deploy
└── .gitignore
```

## 🔑 Gerekli Env Variables

| Variable | Açıklama |
|----------|----------|
| `PERPLEXITY_API_KEY` | AI haberleri araştırması |
| `OPENAI_API_KEY` | Post yazma + görsel prompt |
| `GEMINI_API_KEY` | Görsel üretme |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn post paylaşma |
| `LINKEDIN_PERSON_URN` | LinkedIn profil URN |
| `NOTION_SOCIAL_TOKEN` | Notion log yazma |
| `NOTION_LINKEDIN_DB_ID` | Notion database ID |
| `TZ=Europe/Istanbul` | Railway timezone |

## 🧑‍💻 Lokal Test

```bash
# Dry-run modda çalışır (gerçek API çağrısı yapmaz)
python main.py

# Production modda (gerçek paylaşım)
ENV=production python main.py
```

## 📋 Migrasyon Durumu
- ✅ n8n workflow'ları analiz edildi
- ✅ Python'a birebir çevrildi
- ✅ Syntax kontrolü geçti
- ✅ Railway'e deploy (27 Nisan 2026 — CronJob: `0 5 * * 3,0`)
- ✅ Notion DB `Post Tipi` property eklendi + fail-safe bug fix (1 Nisan 2026)

