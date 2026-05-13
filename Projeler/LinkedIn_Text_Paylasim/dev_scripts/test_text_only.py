import os
import logging

# 1. Ortam Değişkenleri
os.environ["ENV"] = "production"
os.environ["DRY_RUN"] = "0"
os.environ["NOTION_SOCIAL_TOKEN"] = "dummy_token"
os.environ["NOTION_LINKEDIN_DB_ID"] = "dummy_db_id"

import logging
from main import setup_logging
from core.post_writer import PostWriter
from core.linkedin_publisher import LinkedInPublisher

RESEARCH_DATA = "Diageo Türkiye Mayıs 2026 Gelişmeleri: Viski pazarı büyüyor, yeni CEO Dave Lewis görevde."

def run_forced_publish():
    setup_logging()
    logging.info("!!! SADECE METİN İLE LİNKEDİN PAYLAŞIMI TEST EDİLİYOR !!!")
    
    try:
        writer = PostWriter()
        post_text = writer.write_diageo_turkey_post(RESEARCH_DATA)
        
        publisher = LinkedInPublisher()
        # image_path=None ile sadece metin post deniyoruz (Scope kontrolü için)
        post_urn = publisher.create_text_image_post(text=post_text, image_path=None)

        if post_urn:
            url = f"https://www.linkedin.com/feed/update/{post_urn}/"
            print(f"\n🚀 SADECE METİN PAYLAŞIMI BAŞARILI: {url}\n")
        else:
            print("\n❌ SADECE METİN PAYLAŞIMI BAŞARISIZ (403 olabilir).\n")
            
    except Exception as e:
        logging.error(f"Hata: {e}")

if __name__ == "__main__":
    run_forced_publish()
