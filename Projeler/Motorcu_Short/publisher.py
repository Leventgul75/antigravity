"""
Motorcu_Short — Cok Platformlu Yayinci (upload-post.com)
Instagram Reels, TikTok ve YouTube Shorts'a tek API ile video yukler.
"""

import os
import requests
import time

UPLOAD_POST_API_KEY = os.getenv(
    "UPLOAD_POST_API_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNhcmtveUBnbWFpbC5jb20iLCJleHAiOjQ5MzE1NzMwNTAsImp0aSI6IjcyNGNmNWQ4LWNjNzYtNDQzMC04MzNlLWQ1NGI2NmM2YjYwZiJ9.yN_OSuDxexpA0UBn6QTxpnbBfuE2fnTWdf-b8Oghebk"
)
UPLOAD_POST_USER  = os.getenv("UPLOAD_POST_USER", "leventgul")
UPLOAD_POST_URL   = "https://api.upload-post.com/api/upload"


class Publisher:
    def __init__(self):
        self.headers = {"Authorization": f"Apikey {UPLOAD_POST_API_KEY}"}

    # ── Instagram Reels ───────────────────────────────────────────────────────
    def publish_instagram_reels(self, video_path: str, title: str, description: str) -> dict:
        print("    -> Instagram Reels yuklenıyor...")
        with open(video_path, "rb") as vf:
            resp = requests.post(
                UPLOAD_POST_URL,
                headers=self.headers,
                data={
                    "title":          title,
                    "user":           UPLOAD_POST_USER,
                    "platform[]":     "instagram",
                    "media_type":     "REELS",
                    "share_to_feed":  "true",
                    "caption":        description,
                },
                files={"video": ("video.mp4", vf, "video/mp4")},
                timeout=120
            )
        return self._handle_response(resp, "Instagram Reels")

    # ── TikTok ────────────────────────────────────────────────────────────────
    def publish_tiktok(self, video_path: str, title: str) -> dict:
        print("    -> TikTok'a yukleniyor...")
        with open(video_path, "rb") as vf:
            resp = requests.post(
                UPLOAD_POST_URL,
                headers=self.headers,
                data={
                    "title":          title,
                    "user":           UPLOAD_POST_USER,
                    "platform[]":     "tiktok",
                    "privacy_level":  "PUBLIC_TO_EVERYONE",
                },
                files={"video": ("video.mp4", vf, "video/mp4")},
                timeout=120
            )
        return self._handle_response(resp, "TikTok")

    # ── YouTube Shorts ────────────────────────────────────────────────────────
    def publish_youtube_shorts(self, video_path: str, title: str, description: str) -> dict:
        print("    -> YouTube Shorts'a yukleniyor...")
        with open(video_path, "rb") as vf:
            resp = requests.post(
                UPLOAD_POST_URL,
                headers=self.headers,
                data={
                    "title":           title,
                    "user":            UPLOAD_POST_USER,
                    "platform[]":      "youtube",
                    "privacy_status":  "public",
                    "description":     description,
                    "category":        "15",    # Autos & Vehicles
                    "made_for_kids":   "false",
                },
                files={"video": ("video.mp4", vf, "video/mp4")},
                timeout=120
            )
        return self._handle_response(resp, "YouTube Shorts")

    # ── Tum Platformlara Yayinla ──────────────────────────────────────────────
    def publish_all(
        self,
        video_path: str,
        title: str,
        description: str,
        platforms: list = None
    ) -> dict:
        """
        Tum platformlara (veya secilen platformlara) video yukler.
        Basari/basarisizlik ozeti dondurur.
        """
        if platforms is None:
            platforms = ["instagram", "tiktok", "youtube"]

        results = {}
        print(f"\n=== YAYINCILAMA BASLADI: {title} ===")

        if "instagram" in platforms:
            try:
                results["instagram"] = self.publish_instagram_reels(video_path, title, description)
            except Exception as e:
                results["instagram"] = {"success": False, "error": str(e)}
                print(f"    [HATA] Instagram: {e}")

        # Upload-post paralel islemez, kisa bekleme ekleyelim
        time.sleep(3)

        if "tiktok" in platforms:
            try:
                results["tiktok"] = self.publish_tiktok(video_path, title)
            except Exception as e:
                results["tiktok"] = {"success": False, "error": str(e)}
                print(f"    [HATA] TikTok: {e}")

        time.sleep(3)

        if "youtube" in platforms:
            try:
                results["youtube"] = self.publish_youtube_shorts(video_path, title, description)
            except Exception as e:
                results["youtube"] = {"success": False, "error": str(e)}
                print(f"    [HATA] YouTube: {e}")

        print("\n=== YAYINCILAMA TAMAMLANDI ===")
        for platform, result in results.items():
            status = "OK" if result.get("success") else "HATA"
            print(f"  {platform:12s}: {status}")
        return results

    @staticmethod
    def _handle_response(resp: requests.Response, platform: str) -> dict:
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}

        if resp.status_code in (200, 201) and data.get("success"):
            req_id = data.get("request_id", "N/A")
            print(f"    OK  {platform} — request_id: {req_id}")
            return {"success": True, "request_id": req_id, "data": data}
        else:
            print(f"    HATA  {platform} — HTTP {resp.status_code}: {resp.text[:300]}")
            return {"success": False, "http_status": resp.status_code, "data": data}
