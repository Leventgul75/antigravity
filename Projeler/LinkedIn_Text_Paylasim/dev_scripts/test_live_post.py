"""
LIVE LinkedIn test postu — sadece metin paylaşır.
Bu script projenin gerçek modüllerini (config, post_writer, linkedin_publisher)
kullanır, ancak Notion loglamayı opsiyonel bırakır ve görsel adımını atlar.

Kullanım:
    cd "C:\\Users\\levent\\Downloads\\Antigravity\\Antigravity\\Projeler\\LinkedIn_Text_Paylasim"
    python test_live_post.py

Beklenen çıktı:
    'PAYLAŞIM BAŞARILI: https://www.linkedin.com/feed/update/urn:li:share:...'
"""
import os
import logging

# Production modunda gerçek API çağrısı yap
os.environ["ENV"] = "production"
os.environ["DRY_RUN"] = "0"

from logger import setup_logging
from core.linkedin_publisher import LinkedInPublisher

TEST_POST_TEXT = (
    "🧪 Antigravity LinkedIn otomasyon pipeline'ı test paylaşımı\n\n"
    "Bu post, n8n'den Python'a taşınan haftalık Diageo otomasyonunun "
    "canlı paylaşım katmanını doğrulamak için manuel olarak tetiklendi.\n\n"
    "✅ Config fail-fast doğrulaması\n"
    "✅ LinkedIn /rest/posts API çağrısı (LinkedIn-Version: 202604)\n"
    "✅ Notion loglama opsiyonel mod\n"
    "✅ Retry mekanizması aktif\n\n"
    "#Antigravity #Otomasyon #LinkedInAPI"
)


def main():
    setup_logging()
    logging.info("=" * 60)
    logging.info("LIVE LinkedIn TEXT-ONLY test postu başlatılıyor...")
    logging.info("=" * 60)
    logging.info(f"Post metni ({len(TEST_POST_TEXT)} karakter):\n{TEST_POST_TEXT}")

    publisher = LinkedInPublisher()
    post_urn = publisher.create_text_image_post(text=TEST_POST_TEXT, image_path=None)

    if post_urn:
        url = f"https://www.linkedin.com/feed/update/{post_urn}/"
        logging.info("=" * 60)
        logging.info(f"✅ PAYLAŞIM BAŞARILI")
        logging.info(f"Post URN: {post_urn}")
        logging.info(f"LinkedIn URL: {url}")
        logging.info("=" * 60)
        print(f"\n>>> COPY ME: {url}\n")
    else:
        logging.error("❌ PAYLAŞIM BAŞARISIZ — yukarıdaki HTTP hata gövdesini incele.")


if __name__ == "__main__":
    main()
