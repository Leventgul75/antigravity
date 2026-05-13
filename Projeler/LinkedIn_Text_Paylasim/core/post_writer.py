"""
OpenAI GPT-4.1 ile LinkedIn postu yazma.
n8n'deki "Post Yazarı" node'unun birebir karşılığı.
"""
import logging
from datetime import datetime
from openai import OpenAI

from config import settings


class PostWriter:
    """GPT-4.1 kullanarak LinkedIn postu yazar."""

    def __init__(self):
        self.client = OpenAI(api_key=settings.OPENAI_API_KEY)

    def write_diageo_turkey_post(self, research_content: str) -> str:
        """
        Diageo Türkiye haberlerinden LinkedIn postu yazar (5 madde).
        """
        current_date = datetime.now().isoformat()

        system_message = (
            f"Diageo Türkiye hakkındaki güncel ve olumlu haberler: \n{research_content}\n\n"
            f"Date: {current_date}"
        )

        user_message = (
            "Senin görevin, bu araştırma verilerini kullanarak Diageo Türkiye hakkında "
            "profesyonel bir LinkedIn postu yazmak. \n\n"
            "Gereksinimler:\n"
            "1. Posta dikkat çekici bir Hook cümlesi ile başla.\n"
            "2. İçeriği tam olarak 5 madde halinde (bullet points) özetle. Her madde "
            "kısa, net ve iş dünyası diline uygun olmalı.\n"
            "3. Kapanışta etkileşim yaratacak bir CTA (Call to Action) ekle (Örn: Sizin "
            "bu gelişme hakkındaki düşünceniz nedir?).\n"
            "4. Orta düzey, akıcı bir profesyonel Türkçe kullan. İnsansı ve samimi olsun.\n"
            "5. Her paragrafta 1-2 emoji kullan.\n"
            "6. Sona maksimum 3-5 hashtag ekle (Örn: #Diageo #DiageoTürkiye #İçecekSektörü #İşDünyası).\n\n"
            "Sadece LinkedIn'de paylaşılacak yazıyı çıktı olarak vermeni istiyorum. "
            "Başka hiçbir şey (açıklama vb.) yazma."
        )

        return self._generate(system_message, user_message)

    def write_diageo_global_post(self, research_content: str) -> str:
        """
        Diageo Global haberlerinden LinkedIn postu yazar (5 madde).
        """
        current_date = datetime.now().isoformat()

        system_message = (
            f"Diageo global hakkındaki güncel ve olumlu haberler: \n{research_content}\n\n"
            f"Date: {current_date}"
        )

        user_message = (
            "Senin görevin, bu araştırma verilerini kullanarak Diageo'nun global gelişmeleri hakkında "
            "profesyonel bir LinkedIn postu yazmak. \n\n"
            "Gereksinimler:\n"
            "1. Posta dikkat çekici, global etkiye vurgu yapan bir Hook cümlesi ile başla.\n"
            "2. İçeriği tam olarak 5 madde halinde (bullet points) özetle. Global yatırımlar "
            "veya yenilikler üzerinde dur.\n"
            "3. Kapanışta etkileşim yaratacak bir CTA ekle.\n"
            "4. Profesyonel, vizyoner ve akıcı bir Türkçe kullan.\n"
            "5. Her paragrafta 1-2 emoji kullan.\n"
            "6. Sona maksimum 3-5 hashtag ekle (Örn: #Diageo #GlobalHaberler #İşDünyası).\n\n"
            "Sadece LinkedIn'de paylaşılacak yazıyı çıktı olarak vermeni istiyorum. "
            "Başka hiçbir şey yazma."
        )

        return self._generate(system_message, user_message)

    def _generate(self, system_message: str, user_message: str) -> str:
        """GPT-4.1 ile post üretir."""
        if settings.IS_DRY_RUN:
            logging.info(f"[DRY-RUN] GPT-4.1 post yazma atlanıyor.")
            return "[DRY-RUN] 🚀 Bu hafta AI dünyasında neler oldu?\n\n1. OpenAI yeni modelini tanıttı\n2. Google Gemini güncellendi\n\n#AI #YapayZeka"

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": user_message}
                ],
                temperature=0.7
            )
            content = response.choices[0].message.content.strip()
            logging.info(f"Post yazıldı ({len(content)} karakter)")
            return content
        except Exception as e:
            logging.error(f"GPT-4.1 post yazma hatası: {e}", exc_info=True)
            raise
