"""
Faz 1: Lead Generator — Veri Toplama, Analiz ve Filtreleme
Apify Google Maps Scraper ile lokal isletmeleri tarar,
LLM ile gelir potansiyeli skoru verir, zayif site analizi yapar.
"""
import time
import re
import logging
import requests
from typing import Optional

logger = logging.getLogger("web_site_satis.lead_generator")


class LeadGenerator:
    APIFY_ACTOR_ID = "nwua9Gu5YrADL7ZDj"
    APIFY_BASE_URL = "https://api.apify.com/v2"

    def __init__(self, config, notion_service, notifier, ops_logger):
        self.config = config
        self.notion = notion_service
        self.notifier = notifier
        self.ops = ops_logger
        self._using_fallback_key = False

    def _get_apify_key(self):
        return self.config.get_apify_key(fallback=self._using_fallback_key)

    def _build_run_input(self, location, sectors):
        return {
            "language": "tr", "countryCode": "TR",
            "locationQuery": location, "searchStringsArray": sectors,
            "skipClosedPlaces": True, "website": "allPlaces",
            "scrapePlaceDetailPage": True, "scrapeContacts": True,
            "scrapeSocialMediaProfiles": {"instagrams": True},
            "maxReviews": 10, "reviewsSort": "newest",
            "placeMinimumStars": "3.5",
        }

    def run_apify_scraper(self, location=None, sectors=None):
        location = location or self.config.DEFAULT_LOCATION
        sectors = sectors or self.config.get_sectors_list()
        run_input = self._build_run_input(location, sectors)
        logger.info(f"Apify tarama basliyor: {location} — {len(sectors)} sektor")

        for attempt in range(self.config.RETRY_MAX_ATTEMPTS):
            try:
                result = self._execute_apify_run(run_input)
                logger.info(f"Apify tamamlandi: {len(result)} isletme")
                return result
            except requests.exceptions.HTTPError as e:
                if "Monthly usage hard limit exceeded" in str(e):
                    if not self._using_fallback_key and self.config.APIFY_API_KEY_2:
                        self._using_fallback_key = True
                        continue
                    self.notifier.send_alert("Apify quota doldu")
                    return []
                wait = self.config.RETRY_BACKOFF_BASE * (3 ** attempt)
                time.sleep(wait)
            except Exception as e:
                wait = self.config.RETRY_BACKOFF_BASE * (3 ** attempt)
                logger.warning(f"Apify hatasi (deneme {attempt+1}): {e}")
                time.sleep(wait)
        self.ops.error("Apify Retry Tukendi")
        return []

    def _execute_apify_run(self, run_input):
        api_key = self._get_apify_key()
        resp = requests.post(
            f"{self.APIFY_BASE_URL}/acts/{self.APIFY_ACTOR_ID}/runs",
            params={"token": api_key}, json=run_input, timeout=30,
        )
        resp.raise_for_status()
        run_id = resp.json()["data"]["id"]
        status_url = f"{self.APIFY_BASE_URL}/acts/{self.APIFY_ACTOR_ID}/runs/{run_id}"
        for _ in range(120):
            time.sleep(10)
            sr = requests.get(status_url, params={"token": api_key}, timeout=15)
            sr.raise_for_status()
            status = sr.json()["data"]["status"]
            if status == "SUCCEEDED":
                break
            elif status in ("FAILED", "ABORTED", "TIMED-OUT"):
                raise RuntimeError(f"Apify run basarisiz: {status}")
        dataset_id = sr.json()["data"]["defaultDatasetId"]
        dr = requests.get(
            f"{self.APIFY_BASE_URL}/datasets/{dataset_id}/items",
            params={"token": api_key, "format": "json"}, timeout=60,
        )
        dr.raise_for_status()
        return dr.json()

    def calculate_score(self, place, llm_score=5.0):
        rc = place.get("reviewsCount", 0) or 0
        stars = place.get("stars", place.get("totalScore", 0)) or 0
        try: stars = float(stars)
        except: stars = 0
        price_map = {"$": 10, "$$": 20, "$$$": 30, "$$$$": 30}
        ps = price_map.get(place.get("price", ""), 15)
        total = min(rc/100, 1)*25 + max(0, stars-3)*15 + ps + llm_score*1.5
        return round(min(total, 100), 1)

    def get_llm_revenue_score(self, place):
        reviews = place.get("reviews", [])[:10]
        rtexts = "\n".join([f"- {r.get('text','')[:200]}" for r in reviews if r.get("text")])
        prompt = (
            f"Isletme: {place.get('title','')}\nKategori: {place.get('categoryName','')}\n"
            f"Fiyat: {place.get('price','')}\nYorumlar:\n{rtexts}\n\n"
            "Bu isletmenin web sitesi hizmeti satin alabilecek butceye sahip olma "
            "ihtimalini 1-10 arasi puanla. Sadece sayi dondur."
        )
        for attempt in range(self.config.RETRY_MAX_ATTEMPTS):
            try:
                score = self._call_llm(prompt)
                return max(1.0, min(10.0, float(score)))
            except Exception as e:
                if attempt < self.config.RETRY_MAX_ATTEMPTS - 1:
                    time.sleep(30)
                else:
                    return -1

    def _call_llm(self, prompt):
        if self.config.GEMINI_API_KEY:
            return self._call_gemini(prompt)
        return self._call_groq(prompt)

    def _call_gemini(self, prompt):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={self.config.GEMINI_API_KEY}"
        r = requests.post(url, json={"contents":[{"parts":[{"text":prompt}]}],
            "generationConfig":{"temperature":0.1,"maxOutputTokens":10}}, timeout=30)
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

    def _call_groq(self, prompt):
        r = requests.post("https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization":f"Bearer {self.config.GROQ_API_KEY}","Content-Type":"application/json"},
            json={"model":"llama-3.1-70b-versatile","messages":[{"role":"user","content":prompt}],
                  "temperature":0.1,"max_tokens":10}, timeout=30)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()

    def detect_weak_site(self, website_url):
        if not website_url:
            return {"is_weak": False, "signals": [], "signal_count": 0}
        signals = []
        if not website_url.startswith("https://"):
            signals.append("SSL yok")
        try:
            start = time.time()
            url = website_url if website_url.startswith("http") else f"http://{website_url}"
            resp = requests.get(url, timeout=10, headers={"User-Agent":"Mozilla/5.0"}, allow_redirects=True)
            if time.time()-start > 5:
                signals.append("Yavas yukleme")
            html = resp.text.lower()
            if "jquery/1." in html or "jquery-1." in html:
                signals.append("Eski jQuery")
            if "shockwave-flash" in html or ".swf" in html:
                signals.append("Flash")
            if "bootstrap/3." in html or "bootstrap/2." in html:
                signals.append("Eski Bootstrap")
            years = re.findall(r'©\s*(\d{4})', html)
            if years and max(int(y) for y in years) < 2024:
                signals.append("Eski icerik")
        except:
            signals.append("Erisilemedi")
        return {"is_weak": len(signals)>=self.config.WEAK_SITE_SIGNAL_THRESHOLD, "signals":signals, "signal_count":len(signals)}

    def extract_contact(self, place):
        email = place.get("email") or (place.get("emails",[]) or [None])[0]
        phone = place.get("phone", place.get("phoneUnformatted"))
        src = "website" if email else ("instagram_pending" if (place.get("socialProfiles",{}) or {}).get("instagram") else "none")
        return {"email": email, "phone": phone, "contact_source": src}

    def _map_category(self, category):
        if not category: return "_default"
        cl = category.lower()
        if any(k in cl for k in ["restoran","kafe","cafe","pastane","food"]): return "food"
        if any(k in cl for k in ["guzellik","beauty","berber","kuafor","salon"]): return "beauty"
        if any(k in cl for k in ["dis","dental","klinik","clinic","estetik","medikal"]): return "clinic"
        return "_default"

    def _extract_city(self, place):
        addr = place.get("address","")
        for sep in ["/", ","]:
            if sep in addr:
                parts = [p.strip() for p in addr.split(sep)]
                if len(parts) >= 2:
                    return parts[-1] if "Turkey" not in parts[-1] else parts[-2]
        return ""

    def run(self, location=None, sectors=None):
        stats = {"total_scraped":0,"qualified":0,"added_to_notion":0,"rejected":0,"errors":0}
        places = self.run_apify_scraper(location, sectors)
        stats["total_scraped"] = len(places)
        if not places:
            return stats
        for place in places:
            try:
                pid = place.get("placeId","")
                if pid and self.notion.lead_exists(pid):
                    self.notion.update_last_seen(pid)
                    continue
                llm = self.get_llm_revenue_score(place)
                score = self.calculate_score(place, llm if llm>0 else 5.0)
                if score < self.config.SCORE_THRESHOLD_LOW:
                    stats["rejected"] += 1
                    continue
                stats["qualified"] += 1
                ws = place.get("website","")
                weak = self.detect_weak_site(ws) if ws else {"is_weak":False,"signals":[]}
                contact = self.extract_contact(place)
                priority = "Yuksek Oncelik" if score>=self.config.SCORE_THRESHOLD_HIGH else "Dusuk Oncelik"
                status = "Onay Bekliyor" if contact["email"] else "Manuel Iletisim Bekliyor"
                cat = place.get("categoryName","")
                self.notion.add_lead({
                    "place_id":pid, "name":place.get("title","Isimsiz"),
                    "category":cat, "category_key":self._map_category(cat),
                    "address":place.get("address",""), "city":place.get("city",self._extract_city(place)),
                    "phone":contact["phone"], "email":contact["email"],
                    "contact_source":contact["contact_source"],
                    "website":ws, "stars":place.get("stars",0),
                    "review_count":place.get("reviewsCount",0),
                    "score":score, "llm_score":llm, "priority":priority, "status":status,
                    "has_website":bool(ws), "is_weak_site":weak["is_weak"],
                    "weak_site_signals":", ".join(weak["signals"]),
                    "maps_url":place.get("url",""),
                })
                stats["added_to_notion"] += 1
            except Exception as e:
                stats["errors"] += 1
                self.ops.error("Lead Isleme Hatasi", exception=e)
        self.ops.success("Faz 1 Tamamlandi", str(stats))
        return stats
