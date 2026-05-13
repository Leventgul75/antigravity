"""
Perplexity API ile güncel AI haberleri araştırması.
n8n'deki "AI Haberleri" node'unun birebir karşılığı.
"""
import logging
import requests
from datetime import datetime

from config import settings


class Researcher:
    """Perplexity API kullanarak güncel AI haberleri/tipsler araştırır."""

    def __init__(self):
        self.api_key = settings.PERPLEXITY_API_KEY
        self.base_url = settings.PERPLEXITY_BASE_URL

    def research_diageo_turkey(self) -> str:
        """
        Çarşamba günü: Diageo Türkiye ile ilgili son olumlu haberleri araştırır.
        """
        current_date = datetime.now().strftime("%Y-%m-%d")

        prompt = (
            f"You are a research assistant for a professional LinkedIn post writer.\n\n"
            f"Find the most important POSITIVE news, business developments, or successful campaigns "
            f"about 'Diageo Türkiye' (Diageo Turkey) from the last 1 month. "
            f"Please prioritize Turkish local news sources or business magazines. "
            f"STRICT INSTRUCTION: Only include good news, successful initiatives, and positive developments. "
            f"Completely ignore any negative news, controversies, or bad press.\n\n"
            f"Current Date: {current_date}"
        )

        return self._query_perplexity(prompt)

    def research_diageo_global(self) -> str:
        """
        Pazar günü: Diageo Global ile ilgili son olumlu haberleri araştırır.
        """
        current_date = datetime.now().strftime("%Y-%m-%d")

        prompt = (
            f"You are a research assistant for a professional LinkedIn post writer.\n\n"
            f"Find the most important POSITIVE news, strategic investments, financial success, or new product launches "
            f"about 'Diageo' globally from the last 1-2 weeks. "
            f"STRICT INSTRUCTION: Only include good news, successful initiatives, and positive developments. "
            f"Completely ignore any negative news, controversies, or bad press.\n\n"
            f"Current Date: {current_date}"
        )

        return self._query_perplexity(prompt)

    def _query_perplexity(self, prompt: str) -> str:
        """Perplexity API'ye sorgu gönderir ve sonucu döndürür (3 deneme ile)."""
        if settings.IS_DRY_RUN:
            logging.info(f"[DRY-RUN] Perplexity sorgusu atlanıyor. Prompt: {prompt[:100]}...")
            return "[DRY-RUN] Bu hafta AI dünyasında önemli gelişmeler yaşandı. OpenAI yeni modelini tanıttı."

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "sonar",
            "messages": [
                {"role": "user", "content": prompt}
            ]
        }

        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=60)
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                logging.info(f"Perplexity araştırması tamamlandı ({len(content)} karakter)")
                return content
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = (attempt + 1) * 5
                    logging.warning(f"Perplexity denemesi {attempt+1} başarısız: {e}. {wait}s bekleniyor...")
                    time.sleep(wait)
                else:
                    logging.error(f"Perplexity API hatası (tüm denemeler tükendi): {e}", exc_info=True)
                    raise
