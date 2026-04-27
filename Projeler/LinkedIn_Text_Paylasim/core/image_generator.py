"""
GPT-4.1-mini ile görsel prompt üretme + Gemini ile görsel üretme.
n8n'deki "Gorsel Prompt Yazarı" + "Generate an image" node'larının birebir karşılığı.
"""
import logging
import requests
import base64
import os
import tempfile

from openai import OpenAI
from config import settings


class ImageGenerator:
    """İki aşamalı görsel pipeline: prompt üretme (GPT) + görsel üretme (Gemini)."""

    def __init__(self):
        self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
        self.gemini_api_key = settings.GEMINI_API_KEY

    def generate_post_image(self, linkedin_post: str) -> str:
        """
        LinkedIn postu için görsel üretir.
        1. GPT-4.1-mini ile görsel promptu yazar
        2. Gemini ile görseli üretir
        3. Geçici dosya yolunu döndürür

        Returns: Üretilen görselin dosya yolu (str) veya None
        """
        # Adım 1: Görsel prompt üret
        image_prompt = self._generate_image_prompt(linkedin_post)
        if not image_prompt:
            return None

        # Adım 2: Görsel üret
        image_path = self._generate_image_with_gemini(image_prompt)
        return image_path

    def _generate_image_prompt(self, linkedin_post: str) -> str:
        """
        GPT-4.1-mini ile görsel prompt üretir.
        n8n'deki "Gorsel Prompt Yazarı" node'unun birebir karşılığı.
        """
        if settings.IS_DRY_RUN:
            logging.info("[DRY-RUN] Görsel prompt üretme atlanıyor.")
            return "[DRY-RUN] Minimalist AI infographic prompt"

        user_message = (
            f"Aşağıdaki LinkedIn postuna bakarak bu post için bir görsel prompt üretmeni istiyorum. "
            f"Bu post 'Diageo' adlı içecek/alkol şirketi ile ilgilidir. Bu nedenle görselin, "
            f"şık, profesyonel ve kurumsal bir iş/içecek dünyası konseptinde olması gerekiyor "
            f"(örneğin: premium bardaklar, kurumsal kutlamalar, şık etkinlik alanları veya "
            f"kurumsal başarıyı simgeleyen vizyoner konseptler). Marka logoları oluşturmada AI "
            f"zorlanabileceği için logo istemekten ziyade premium ve kurumsal hissi veren, "
            f"haber niteliğinde bir illüstrasyon veya estetik bir kompozisyon tarif et. "
            f"Görsel promptu İngilizce olarak ve detaylı yaz. Başka hiçbir şey ekleme.\n\n"
            f"LINKEDIN POSTU: \n {linkedin_post}"
        )

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "user", "content": user_message}
                ],
                temperature=0.7
            )
            prompt = response.choices[0].message.content.strip()
            logging.info(f"Görsel prompt üretildi ({len(prompt)} karakter)")
            return prompt
        except Exception as e:
            logging.error(f"GPT-4.1-mini görsel prompt hatası: {e}", exc_info=True)
            raise

    def _generate_image_with_gemini(self, prompt: str) -> str:
        """
        Gemini ile görsel üretir.
        n8n'deki "Generate an image" node'unun karşılığı.
        Gemini Imagen API kullanır.

        Returns: Üretilen görselin geçici dosya yolu veya None
        """
        if settings.IS_DRY_RUN:
            logging.info("[DRY-RUN] Gemini görsel üretme atlanıyor.")
            return None

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={self.gemini_api_key}"

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt}
                    ]
                }
            ],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"]
            }
        }

        try:
            resp = requests.post(url, json=payload, timeout=120)
            resp.raise_for_status()
            data = resp.json()

            # Gemini response'tan image verisini çıkar
            candidates = data.get("candidates", [])
            if not candidates:
                logging.error(f"Gemini boş yanıt döndü: {data}")
                return None

            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                inline_data = part.get("inlineData")
                if inline_data and inline_data.get("mimeType", "").startswith("image/"):
                    # Base64 decode ve dosyaya yaz
                    image_bytes = base64.b64decode(inline_data["data"])
                    mime = inline_data["mimeType"]
                    ext = "png" if "png" in mime else "jpg"

                    tmp_file = tempfile.NamedTemporaryFile(
                        suffix=f".{ext}",
                        prefix="linkedin_img_",
                        dir=tempfile.gettempdir(),
                        delete=False
                    )
                    tmp_file.write(image_bytes)
                    tmp_file.close()

                    logging.info(f"Gemini görseli üretildi: {tmp_file.name} ({len(image_bytes)} bytes)")
                    return tmp_file.name

            logging.error(f"Gemini yanıtında görsel bulunamadı. Parts: {[p.keys() for p in parts]}")
            return None

        except Exception as e:
            logging.error(f"Gemini görsel üretme hatası: {e}", exc_info=True)
            raise
