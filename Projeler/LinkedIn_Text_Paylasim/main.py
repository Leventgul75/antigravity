"""
LinkedIn Text Paylaşım — Ana orkestratör.
Haftada 2 gün çalışan Diageo odaklı otomasyon:
  1. Çarşamba (TR 08:00): Diageo Türkiye
  2. Pazar (TR 08:00): Diageo Global

Pipeline (her ikisi aynı):
  Schedule → Perplexity (Araştır) → GPT-4.1 (Post Yaz)
  → GPT-4.1-mini (Görsel Prompt) → Gemini (Görsel Üret)
  → LinkedIn API (Paylaş)
"""
import logging
import os
import time
import schedule

from logger import setup_logging
from core.researcher import Researcher
from core.post_writer import PostWriter
from core.image_generator import ImageGenerator
from core.linkedin_publisher import LinkedInPublisher

def run_diageo_turkey():
    """
    Workflow 1: Diageo Türkiye — Her Çarşamba
    """
    logging.info("=" * 60)
    logging.info("WORKFLOW 1: Diageo Türkiye başlatılıyor...")
    logging.info("=" * 60)

    post_type = "Diageo Türkiye"
    try:
        researcher = Researcher()
        logging.info("Adım 1/5: Perplexity ile Diageo Türkiye haberleri araştırılıyor...")
        research_content = researcher.research_diageo_turkey()
        logging.info(f"Araştırma tamamlandı ({len(research_content)} karakter)")

        # Step 2: GPT-4.1 ile post yaz
        writer = PostWriter()
        logging.info("Adım 2/5: GPT-4.1 ile LinkedIn postu yazılıyor...")
        post_text = writer.write_diageo_turkey_post(research_content)
        logging.info(f"Post yazıldı ({len(post_text)} karakter)")

        # Step 3: GPT-4.1-mini ile görsel prompt üret + Gemini ile görsel üret
        img_gen = ImageGenerator()
        logging.info("Adım 3/5: Görsel prompt üretiliyor + Gemini ile görsel oluşturuluyor...")
        image_path = img_gen.generate_post_image(post_text)
        if image_path:
            logging.info(f"Görsel üretildi: {image_path}")
        else:
            logging.warning("Görsel üretilemedi, sadece metin post atılacak.")

        # Step 4: LinkedIn'e paylaş
        publisher = LinkedInPublisher()
        logging.info("Adım 4/5: LinkedIn'e paylaşılıyor...")
        post_urn = publisher.create_text_image_post(text=post_text, image_path=image_path)

        if post_urn:
            linkedin_url = f"https://www.linkedin.com/feed/update/{post_urn}/"
            logging.info("=" * 60)
            logging.info(f"✅ BAŞARILI: Diageo Türkiye postu paylaşıldı!")
            logging.info(f"LinkedIn URL: {linkedin_url}")
            logging.info("=" * 60)
        else:
            logging.error("LinkedIn post oluşturulamadı!")

        # Temizlik: geçici görsel dosyasını sil
        if image_path and os.path.exists(image_path):
            os.remove(image_path)
            logging.info(f"Geçici görsel silindi: {image_path}")

    except Exception as e:
        logging.error(f"FATAL: Diageo Türkiye workflow hatası: {e}", exc_info=True)


def run_diageo_global():
    """
    Workflow 2: Diageo Global — Her Pazar
    """
    logging.info("=" * 60)
    logging.info("WORKFLOW 2: Diageo Global başlatılıyor...")
    logging.info("=" * 60)

    post_type = "Diageo Global"
    try:
        researcher = Researcher()
        logging.info("Adım 1/5: Perplexity ile Diageo Global haberleri araştırılıyor...")
        research_content = researcher.research_diageo_global()
        logging.info(f"Araştırma tamamlandı ({len(research_content)} karakter)")

        # Step 2: GPT-4.1 ile post yaz
        writer = PostWriter()
        logging.info("Adım 2/5: GPT-4.1 ile LinkedIn postu yazılıyor...")
        post_text = writer.write_diageo_global_post(research_content)
        logging.info(f"Post yazıldı ({len(post_text)} karakter)")

        # Step 3: GPT-4.1-mini ile görsel prompt üret + Gemini ile görsel üret
        img_gen = ImageGenerator()
        logging.info("Adım 3/5: Görsel prompt üretiliyor + Gemini ile görsel oluşturuluyor...")
        image_path = img_gen.generate_post_image(post_text)
        if image_path:
            logging.info(f"Görsel üretildi: {image_path}")
        else:
            logging.warning("Görsel üretilemedi, sadece metin post atılacak.")

        # Step 4: LinkedIn'e paylaş
        publisher = LinkedInPublisher()
        logging.info("Adım 4/5: LinkedIn'e paylaşılıyor...")
        post_urn = publisher.create_text_image_post(text=post_text, image_path=image_path)

        if post_urn:
            linkedin_url = f"https://www.linkedin.com/feed/update/{post_urn}/"
            logging.info("=" * 60)
            logging.info(f"✅ BAŞARILI: Diageo Global postu paylaşıldı!")
            logging.info(f"LinkedIn URL: {linkedin_url}")
            logging.info("=" * 60)
        else:
            logging.error("LinkedIn post oluşturulamadı!")

        # Temizlik
        if image_path and os.path.exists(image_path):
            os.remove(image_path)
            logging.info(f"Geçici görsel silindi: {image_path}")

    except Exception as e:
        logging.error(f"FATAL: Diageo Global workflow hatası: {e}", exc_info=True)


if __name__ == "__main__":
    setup_logging()

    import os
    from datetime import datetime
    mode = os.environ.get("RUN_MODE", "cron").lower()

    if mode == "schedule":
        # Lokal geliştirme veya sürekli çalışan mod
        logging.info("LinkedIn_Text_Paylasim started in SCHEDULE mode (local dev).")
        logging.info("Zamanlama: Çarşamba 08:00 (Diageo Türkiye) + Pazar 08:00 (Diageo Global)")
        schedule.every().wednesday.at("08:00").do(run_diageo_turkey)
        schedule.every().sunday.at("08:00").do(run_diageo_global)
        while True:
            schedule.run_pending()
            time.sleep(60)
    else:
        # Railway Cron modu: container açılır, gün kontrolü yapar, ilgili job çalışır, exit.
        # Cron: 0 5 * * 3,0 (UTC 05:00 Çarşamba+Pazar = TR 08:00)
        today = datetime.utcnow().weekday()  # 0=Monday, 2=Wednesday, 6=Sunday
        logging.info(f"LinkedIn_Text_Paylasim started in CRON mode. Today is weekday={today}")

        if today == 2:  # Wednesday
            logging.info("Bugün Çarşamba — Diageo Türkiye workflow'u çalıştırılıyor...")
            run_diageo_turkey()
        elif today == 6:  # Sunday
            logging.info("Bugün Pazar — Diageo Global workflow'u çalıştırılıyor...")
            run_diageo_global()
        else:
            logging.info(f"Bugün ne Çarşamba ne Pazar (weekday={today}). Atlanıyor.")

        logging.info("Job finished. Container will now exit.")
