"""
LinkedIn API ile metin + görsel post paylaşma.
n8n'deki "Create a post" node'unun birebir karşılığı.
Görsel paylaşım için Images API (registerUpload + upload + post) kullanır.
"""
import logging
import requests
import os

from config import settings


class LinkedInPublisher:
    """LinkedIn'e metin + görsel post paylaşır."""

    API_BASE = "https://api.linkedin.com"

    def __init__(self):
        self.access_token = settings.LINKEDIN_ACCESS_TOKEN
        self.person_urn = settings.LINKEDIN_PERSON_URN
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "LinkedIn-Version": "202403",
            "X-Restli-Protocol-Version": "2.0.0",
        }

    def create_text_image_post(self, text: str, image_path: str = None) -> str:
        """
        LinkedIn'e metin + görsel post atar.
        n8n'de shareMediaCategory: "IMAGE" olarak ayarlanmış.

        Args:
            text: Post metni
            image_path: Görsel dosya yolu (None ise sadece metin post)

        Returns: Post URN veya None
        """
        if settings.IS_DRY_RUN:
            logging.info(f"[DRY-RUN] LinkedIn post atlanıyor: '{text[:80]}...'")
            return "urn:li:share:mock_post_dry_run"

        # Görsel varsa önce yükle
        image_urn = None
        if image_path and os.path.exists(image_path):
            image_urn = self._upload_image(image_path)
            if not image_urn:
                logging.warning("Görsel yüklenemedi, sadece metin post atılacak.")

        # Post oluştur
        return self._create_post(text, image_urn)

    def _upload_image(self, image_path: str) -> str:
        """
        Görseli LinkedIn'e yükler ve asset URN döndürür.
        LinkedIn Images API (registerUpload + binary upload).
        """
        try:
            # Step 1: Register Upload
            register_url = f"{self.API_BASE}/v2/assets?action=registerUpload"
            register_payload = {
                "registerUploadRequest": {
                    "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
                    "owner": self.person_urn,
                    "serviceRelationships": [
                        {
                            "relationshipType": "OWNER",
                            "identifier": "urn:li:userGeneratedContent"
                        }
                    ]
                }
            }

            resp = requests.post(register_url, headers=self.headers, json=register_payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            upload_url = data["value"]["uploadMechanism"][
                "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
            ]["uploadUrl"]
            asset = data["value"]["asset"]

            logging.info(f"Görsel upload kaydı başarılı. Asset: {asset}")

            # Step 2: Upload binary
            upload_headers = {
                "Authorization": f"Bearer {self.access_token}",
            }

            with open(image_path, "rb") as f:
                image_data = f.read()

            resp = requests.put(upload_url, headers=upload_headers, data=image_data, timeout=60)
            if resp.status_code not in (200, 201):
                logging.error(f"Görsel yükleme hatası: {resp.status_code} - {resp.text[:300]}")
                return None

            logging.info(f"Görsel LinkedIn'e yüklendi: {asset}")
            return asset

        except Exception as e:
            logging.error(f"LinkedIn görsel yükleme hatası: {e}", exc_info=True)
            return None

    def _create_post(self, text: str, image_urn: str = None) -> str:
        """
        LinkedIn post oluşturur (metin veya metin+görsel).
        n8n'deki "Create a post" node'u — shareMediaCategory: IMAGE.
        """
        url = f"{self.API_BASE}/rest/posts"

        payload = {
            "author": self.person_urn,
            "commentary": text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": []
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False
        }

        # Görsel varsa content ekle
        if image_urn:
            payload["content"] = {
                "media": {
                    "title": text[:100] if text else "Post",
                    "id": image_urn,
                }
            }

        try:
            resp = requests.post(url, headers=self.headers, json=payload, timeout=30)
            if resp.status_code in (200, 201):
                post_urn = resp.headers.get("x-restli-id", "")
                if not post_urn:
                    data = resp.json() if resp.text else {}
                    post_urn = data.get("id", "unknown")

                logging.info(f"LinkedIn post başarıyla oluşturuldu! Post URN: {post_urn}")
                return post_urn
            else:
                logging.error(f"LinkedIn post oluşturma hatası: {resp.status_code} - {resp.text[:500]}")
                return None
        except Exception as e:
            logging.error(f"LinkedIn post hatası: {e}", exc_info=True)
            return None
