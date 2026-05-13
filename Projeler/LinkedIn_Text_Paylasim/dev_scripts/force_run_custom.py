import os
import logging

# 1. Ortam Değişkenleri (Config yüklenmeden önce)
os.environ["ENV"] = "production"
os.environ["DRY_RUN"] = "0"
os.environ["NOTION_SOCIAL_TOKEN"] = "dummy_token"
os.environ["NOTION_LINKEDIN_DB_ID"] = "dummy_db_id"

import logging
from main import setup_logging
from core.post_writer import PostWriter
from core.image_generator import ImageGenerator
from core.linkedin_publisher import LinkedInPublisher
from core.notion_logger import NotionLogger

# Hazırladığım araştırma verisi (Perplexity 401 verdiği için manuel enjekte ediyoruz)
RESEARCH_DATA = """
Mayıs 2026 Diageo Türkiye ve Global Gelişmeleri:
- ABD'nin viski ithalatındaki tarifeleri kaldırma kararı sonrası Diageo hisselerinde ciddi yükseliş kaydedildi.
- Ocak 2026'da göreve başlayan yeni CEO Dave Lewis (eski Tesco CEO'su) yönetiminde şirket yeni bir döneme girdi.
- Diageo Türkiye Genel Müdürü Bahar Uçanlar, Türkiye pazarında viski tüketiminin rakı tüketimini geçme eğiliminde olduğunu ve "premium-laşma" stratejisinin başarıyla sürdüğünü belirtti.
- Şirket Türkiye pazarında globalleşme ve proaktif veri takibi odaklı büyüme hedeflerine devam ediyor.
"""

def run_forced_publish():
    setup_logging()
    logging.info("!!! ÖZEL VERİ İLE LİNKEDİN PAYLAŞIMI BAŞLATILIYOR !!!")
    
    try:
        # Adım 1: Post Yaz (OpenAI)
        writer = PostWriter()
        logging.info("Adım 1/3: GPT-4o ile LinkedIn postu yazılıyor...")
        post_text = writer.write_diageo_turkey_post(RESEARCH_DATA)
        logging.info(f"Post yazıldı:\n{post_text}")

        # Adım 2: Görsel Üret (Gemini)
        img_gen = ImageGenerator()
        logging.info("Adım 2/3: Görsel üretiliyor...")
        image_path = img_gen.generate_post_image(post_text)
        logging.info(f"Görsel yolu: {image_path}")

        # Adım 3: LinkedIn'e Paylaş
        publisher = LinkedInPublisher()
        logging.info("Adım 3/3: LinkedIn'e paylaşılıyor...")
        post_urn = publisher.create_text_image_post(text=post_text, image_path=image_path)

        if post_urn:
            url = f"https://www.linkedin.com/feed/update/{post_urn}/"
            logging.info(f"✅ BAŞARILI! LinkedIn URL: {url}")
            print(f"\n🚀 PAYLAŞIM BAŞARILI: {url}\n")
        else:
            logging.error("LinkedIn paylaşımı başarısız oldu.")
            
    except Exception as e:
        logging.error(f"Hata: {e}", exc_info=True)

if __name__ == "__main__":
    run_forced_publish()
