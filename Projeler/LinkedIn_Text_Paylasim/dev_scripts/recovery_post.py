
import os
import logging
from datetime import datetime

# Set production mode
os.environ["ENV"] = "production"
os.environ["DRY_RUN"] = "0"

from logger import setup_logging
from core.post_writer import PostWriter
from core.linkedin_publisher import LinkedInPublisher

# Gathered Research Content (Manually provided because Perplexity key failed)
RESEARCH_DIAGEO_GLOBAL = """
1. Q3 Fiscal 2026 Results: Diageo reported a 0.3% increase in organic net sales, beating analyst expectations. Reported net sales grew by 2.3%.
2. Regional Performance: Growth in Europe, Latin America, and Africa helped offset North America weakness.
3. The Cocktail Collection: Launched a new line of premium 100ml canned RTD cocktails in the U.S. (Ketel One, Bulleit, Crown Royal).
4. Rare Series: Introduced a collection of five rare aged single malts, including a 55-year-old Glenury Royal (oldest ever released).
5. Efficiency Program: "Accelerate" program on track to deliver $300M in savings by end of FY2026.
"""

RESEARCH_DIAGEO_TURKEY = """
1. Finansal Başarı: Diageo 3. çeyrek sonuçları beklentileri aştı, organik gelir artışı global hisse performansına olumlu yansıdı.
2. Stratejik Rol: Diageo Türkiye, global yapı içinde yetenek havuzu ve büyüme katalizörü rolünü sürdürüyor.
3. İnsan Kaynakları: "Yeni Bir Hayat Internship Program 2026" staj programı başlatıldı, genç yeteneklere kariyer fırsatı sunuluyor.
4. Kurumsal Başarı: Yöneticiler Fortune Türkiye ve Fast Company listelerinde başarıyla yer aldı.
5. Sürdürülebilirlik ve Dijitalleşme: Üretim tesislerinde kalite ve dijitalleşme standartları yükseltilmeye devam ediyor.
"""

def run_recovery(post_type, research_content):
    logging.info(f"--- RECOVERY RUN: {post_type} ---")
    
    writer = PostWriter()
    publisher = LinkedInPublisher()
    
    try:
        # Step 1: Write post
        if post_type == "Diageo Global":
            post_text = writer.write_diageo_global_post(research_content)
        else:
            post_text = writer.write_diageo_turkey_post(research_content)
            
        logging.info(f"Post written ({len(post_text)} characters)")
        
        # Step 2: Publish (Text-only as Gemini is exhausted)
        post_urn = publisher.create_text_image_post(text=post_text, image_path=None)
        
        if post_urn:
            url = f"https://www.linkedin.com/feed/update/{post_urn}/"
            logging.info(f"✅ SUCCESS: {post_type} posted!")
            logging.info(f"URL: {url}")
        else:
            logging.error(f"❌ FAILED to post {post_type}")
            
    except Exception as e:
        logging.error(f"Error in recovery run: {e}", exc_info=True)

if __name__ == "__main__":
    setup_logging()
    
    # Run Sunday (Global)
    run_recovery("Diageo Global", RESEARCH_DIAGEO_GLOBAL)
    
    # Run Wednesday (Turkey)
    run_recovery("Diageo Turkey", RESEARCH_DIAGEO_TURKEY)
