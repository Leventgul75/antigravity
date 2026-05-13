# LinkedIn Text Paylaşım

> n8n'den Antigravity'ye taşınan LinkedIn metin + görsel paylaşım otomasyon projesi.
> İki ayrı n8n workflow'u tek bir Python servisinde birleştirildi.

## Ne Yapar?

Haftada iki gün **Diageo** odağında LinkedIn postu otomatik üretir ve Levent Gül'ün hesabından (`levent.gul@diageo.com`) paylaşır:

| Gün | Saat | İçerik | Format |
|-----|------|--------|--------|
| **Çarşamba** | 08:00 (TR) | Diageo Türkiye hakkındaki olumlu haberler | 5 Maddelik Özet + Görsel |
| **Pazar** | 08:00 (TR) | Diageo hakkındaki global olumlu haberler | 5 Maddelik Özet + Görsel |

## Pipeline (Her İki Workflow İçin Aynı)

```
Schedule Trigger (Railway cron: 0 5 * * 3,0 UTC = 08:00 TR Çar+Paz)
  → Notion (duplicate kontrol — bu hafta zaten atılmış mı?)
  → Perplexity API (Diageo haberleri araştır — sonar modeli)
  → GPT-4o (LinkedIn postu yaz)
  → GPT-4o-mini (Görsel prompt üret)
  → Gemini 2.0 Flash (Görsel üret)
  → LinkedIn /v2/ugcPosts (Metin + görsel paylaş)
  → Notion (Log yaz)
```

## Dosya Yapısı

```
LinkedIn_Text_Paylasim/
├── main.py                  → Orkestratör (cron veya schedule mode)
├── config.py                → Fail-fast env doğrulama (Notion opsiyonel)
├── logger.py                → Standart loglama
├── rotate_token.py          → 60 günde bir LinkedIn token yenileme yardımcısı
├── core/
│   ├── researcher.py        → Perplexity API (sonar)
│   ├── post_writer.py       → GPT-4o (post yazma)
│   ├── image_generator.py   → GPT-4o-mini (prompt) + Gemini (görsel)
│   ├── linkedin_publisher.py→ LinkedIn /v2/ugcPosts (paylaşım)
│   └── notion_logger.py     → Notion loglama + duplicate kontrol
├── dev_scripts/             → Geliştirme/debug scriptleri (production'da kullanılmaz)
├── n8n_workflows/           → Orijinal n8n JSON dosyaları (referans)
├── requirements.txt         → Pinned dependencies
├── railway.json             → Railway deploy + cron config
└── .gitignore
```

## Gerekli Env Variables

`_knowledge/credentials/master.env` içinden okunur. Eksikse boot fail-fast eder (Notion hariç — opsiyoneldir).

| Variable | Zorunlu? | Açıklama |
|----------|----------|----------|
| `PERPLEXITY_API_KEY` | ✅ | AI haberleri araştırması |
| `OPENAI_API_KEY` | ✅ | Post yazma + görsel prompt |
| `GEMINI_API_KEY` | ✅ | Görsel üretme |
| `LINKEDIN_ACCESS_TOKEN` | ✅ | LinkedIn post paylaşma (60 gün geçerli) |
| `LINKEDIN_PERSON_URN` | ✅ | `urn:li:person:XXX` formatında token sahibi |
| `NOTION_TOKEN` (veya `NOTION_SOCIAL_TOKEN`) | ⚪ Opsiyonel | Notion log yazma — yoksa loglama skip |
| `NOTION_LINKEDIN_DB_ID` | ⚪ Opsiyonel | Notion database ID — yoksa loglama skip |
| `TZ=Europe/Istanbul` | ⚪ | Railway timezone |
| `ENV=production` | ✅ Production'da | development olursa dry-run moda geçer |

## LinkedIn API Mimarisi

Bu app **Marketing Developer Platform** onayı olmadığından LinkedIn'in yeni `/rest/posts` endpoint'i kapalı. Onun yerine eski (ama hâlâ desteklenen) `/v2/ugcPosts` endpoint'i kullanılıyor — sadece `w_member_social` scope'u yeterli.

**OAuth scope'ları (zorunlu):**

- `openid` + `profile` + `email` → token sahibinin member URN'ini (`sub`) almak için
- `w_member_social` → public/connections post atmak için

## Token Rotasyonu (60 Günde Bir)

LinkedIn member tokenları **60 gün** sonra sona erer. Yenileme akışı:

1. https://www.linkedin.com/developers/tools/oauth/token-generator → Client ID `77jj0hg4xjxlos` olan app'i seç
2. Scope'ları işaretle: `openid`, `profile`, `email`, `w_member_social` → **Request access token** → **Allow**
3. Yeni `Access token`'ı kopyala, `_knowledge/credentials/master.env` içindeki `LINKEDIN_ACCESS_TOKEN`'a yapıştır
4. Şu komutu çalıştır:
   ```powershell
   cd LinkedIn_Text_Paylasim
   python rotate_token.py
   ```
   Bu script `/v2/userinfo`'dan `sub`'u alıp `LINKEDIN_PERSON_URN`'i otomatik günceller. Hiç post atmaz.
5. Railway env vars'ı güncelle (Dashboard → Variables → `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_PERSON_URN`)

## Lokal Test

```powershell
# Dry-run modda çalışır — gerçek API çağrısı yapmaz
python main.py

# Schedule mode — sürekli çalışan, lokal cron simülasyonu
$env:RUN_MODE = "schedule"; python main.py

# Production modda gerçek paylaşım (cron mode tek seferlik gün kontrolü + exit)
$env:ENV = "production"; python main.py

# Sadece-metin canlı test (görsel atlanır, Notion log opsiyonel)
python dev_scripts/test_live_post.py
```

## Deploy (Railway)

`railway.json` cron'u `0 5 * * 3,0` UTC = TR 08:00 Çarşamba+Pazar olarak ayarlı. Container açılır, weekday kontrolü yapar, ilgili workflow çalışır, exit eder.

**Yeni deploy:**
```bash
git add .
git commit -m "fix: ugcPosts endpoint, opsiyonel Notion, token rotasyon yardımcısı"
git push
```
Railway otomatik build alır.

**Manuel tetikleme** (test için): Railway Dashboard → Service → "Trigger deploy" veya cron'un bir sonraki tetiklemesini bekle.

## Migrasyon ve Stabilizasyon Geçmişi

- ✅ n8n workflow'ları analiz edildi ve Python'a çevrildi (Nisan 2026)
- ✅ Railway'e deploy edildi (CronJob: `0 5 * * 3,0`)
- ✅ **Stabilize (28 Nisan 2026):**
    - Model isimleri düzeltildi (`gpt-4.1` → `gpt-4o`)
    - Eksik Notion konfigürasyonu ve loglama entegrasyonu tamamlandı
    - `railway.json` cron çakışması ve timezone hatası giderildi
    - LinkedIn ve Perplexity API çağrılarına Retry mekanizması eklendi
    - Duplicate kontrolü (`is_already_posted_this_week`) aktif edildi
- ✅ **Canlı Test ve Endpoint Düzeltmesi (2 Mayıs 2026):**
    - Notion env değişkenleri opsiyonel hale getirildi (`NOTION_TOKEN` fallback)
    - `/rest/posts` (Marketing Dev Platform gerektiriyor) → `/v2/ugcPosts` geçişi
    - `LINKEDIN_PERSON_URN` doğru formatla güncellendi (`urn:li:person:XzkTtkcubR`)
    - OAuth token `openid + profile + email + w_member_social` scope'larıyla yenilendi
    - **İlk başarılı canlı post:** `urn:li:share:7456407141017518080`
    - `rotate_token.py` token rotasyon yardımcısı eklendi
