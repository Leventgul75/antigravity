"""
Notion'a LinkedIn Text paylaşım logları yazan modül.
Mevcut LinkedIn_Paylasim projesindeki notion_logger.py ile aynı DB'yi kullanır.
"""
import requests
import logging
from datetime import datetime, timezone

from config import settings


class NotionLogger:
    """LinkedIn Text Paylaşım aktivitelerini Notion'a loglar."""

    def __init__(self):
        self.token = settings.NOTION_TOKEN
        self.db_id = settings.NOTION_LINKEDIN_DB_ID
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
        }

    def is_already_posted_this_week(self, post_type: str) -> bool:
        """
        Bu hafta aynı tipte post atılıp atılmadığını kontrol eder.
        Duplicate paylaşım önleme.

        Args:
            post_type: "Haftalık AI Haberleri" veya "Haftalık AI Tavsiyesi"
        """
        try:
            # Bu haftanın başlangıcını hesapla (Pazartesi)
            now = datetime.now(timezone.utc)
            week_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            # Haftanın başına git (Pazartesi)
            days_since_monday = now.weekday()
            from datetime import timedelta
            week_start = week_start - timedelta(days=days_since_monday)

            url = f"https://api.notion.com/v1/databases/{self.db_id}/query"
            payload = {
                "filter": {
                    "and": [
                        {
                            "property": "Post Tipi",
                            "select": {"equals": post_type}
                        },
                        {
                            "property": "Paylaşım Tarihi",
                            "date": {"on_or_after": week_start.isoformat()}
                        },
                        {
                            "property": "Status",
                            "select": {"equals": "Success"}
                        }
                    ]
                }
            }
            resp = requests.post(url, headers=self.headers, json=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            already_posted = len(data.get("results", [])) > 0
            if already_posted:
                logging.info(f"Bu hafta zaten '{post_type}' postu atılmış. Atlanıyor.")
            return already_posted
        except Exception as e:
            logging.error(f"Notion duplicate kontrol hatası: {e}", exc_info=True)
            # Fail-open: API hata verirse paylaşıma devam et.
            # Duplikat riski var ama hiç paylaşmamaktan iyidir.
            return False

    def log_post(
        self,
        post_type: str,
        status: str,
        post_text: str = "",
        linkedin_url: str = "",
        image_prompt: str = "",
        error_message: str = ""
    ):
        """
        Post bilgilerini Notion'a loglar.

        Args:
            post_type: "Haftalık AI Haberleri" veya "Haftalık AI Tavsiyesi"
            status: "Success", "Failed"
            post_text: LinkedIn post metni
            linkedin_url: Paylaşım URL'i
            image_prompt: Üretilen görsel promptu
            error_message: Hata durumunda açıklama
        """
        if settings.IS_DRY_RUN:
            logging.info(f"[DRY-RUN] Notion log atlanıyor -> Tip: {post_type}, Status: {status}")
            return True

        now_iso = datetime.now(timezone.utc).isoformat()

        try:
            url = "https://api.notion.com/v1/pages"
            properties = {
                "Video ID": {
                    "title": [
                        {"text": {"content": f"text-post-{datetime.now().strftime('%Y%m%d-%H%M')}"}}
                    ]
                },
                "Status": {
                    "select": {"name": status}
                },
                "Platform": {
                    "select": {"name": "LinkedIn"}
                },
                "Paylaşım Tarihi": {
                    "date": {"start": now_iso}
                },
            }

            # Post Tipi (select property — Notion DB'de oluşturulmalı)
            properties["Post Tipi"] = {"select": {"name": post_type}}

            if linkedin_url:
                properties["LinkedIn URL"] = {"url": linkedin_url}

            if post_text:
                properties["LinkedIn Caption"] = {
                    "rich_text": [{"text": {"content": post_text[:2000]}}]
                }

            if error_message:
                properties["Filter Sebebi"] = {
                    "rich_text": [{"text": {"content": error_message[:2000]}}]
                }

            payload = {
                "parent": {"database_id": self.db_id},
                "properties": properties
            }
            resp = requests.post(url, headers=self.headers, json=payload, timeout=10)
            resp.raise_for_status()
            logging.info(f"Notion'a loglandı -> Tip: {post_type}, Status: {status}")
            return True
        except Exception as e:
            logging.error(f"Notion log hatası: {e}", exc_info=True)
            return False
