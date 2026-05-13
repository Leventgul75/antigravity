"""
Motorcu_Short — Levent Gül Yüz Referanslı Kawasaki KLE500 Video Üretici
Kie.ai Seedance 2 (image-to-video) + Levent'in yüz fotoğrafı ile sakin motorcu videosu üretir.

Kullanım: python generate_motorcu_video.py
"""

import os
import sys
import time
import base64
import json
import requests

# ── Sabitler ──────────────────────────────────────────────────────────────────
KIE_API_KEY   = "5b3f6046a01602bde7abbc736a73ac3e"
IMGBB_API_KEY = "5b21d477031954572b791600e969977a"

BASE_URL  = "https://api.kie.ai/api/v1"
HEADERS   = {
    "Authorization": f"Bearer {KIE_API_KEY}",
    "Content-Type":  "application/json"
}

# Referans görseller
SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
FACE_IMG_PATH = r"C:\Users\levent\.gemini\antigravity\knowledge\lgai-marka-gorselleri\artifacts\levent_gul_yuz_referans.jpg"
BIKE_IMG_URL  = "https://bikez.com/pictures/kawasaki/2006/23879_0_1_4_kle%20500_Image%20credits%20-%20Kawasaki.jpg"
BIKE_IMG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kle500_reference.jpg")

# ── Video prompt (İngilizce, ultra-detaylı KLE500 cockpit) ────────────────────
VIDEO_PROMPT = (
    "Cinematic helmet-cam / over-the-handlebars POV of a peaceful motorcycle ride on the world's most "
    "scenic coastal mountain road. "
    "MOTORCYCLE — EXACT MATCH REQUIRED: a 2006 Kawasaki KLE500 adventure-tourer in bright metallic blue. "
    "The cockpit is clearly visible in the foreground: "
    "a wide black plastic instrument binnacle housing TWO round analog gauges with amber/golden faces — "
    "LEFT: large speedometer reading 0-200 km/h with white numerals on amber background, "
    "RIGHT: smaller tachometer with identical amber face, redline at 12 x1000 r/min; "
    "bottom-left of the binnacle has THREE indicator lights: two red warning lights (top & bottom) and "
    "one blue high-beam light in the middle; top-right has two round green turn-signal indicators side by side "
    "and a green N (neutral) indicator next to them; a small round TRIP reset button sits below the speedometer. "
    "The handlebar is black with round mirrors on each side. "
    "Beyond the bars, a winding asphalt road curves through turquoise coastal cliffs on one side, "
    "lush pine forest on the other, golden late-afternoon sunlight. "
    "Rider glimpsed in mirrors: bald head, salt-and-pepper goatee, full-face helmet visor up. "
    "Smooth, unhurried ride — no traffic. Camera occasionally pans to distant mountains and sparkling sea. "
    "Warm cinematic color grade. "
    "Audio: soft fingerpicked acoustic guitar + gentle wind + distant birds — calm, meditative. "
    "Vertical 9:16 format, 720p, 15 seconds."
)

# ── Yardımcı Fonksiyonlar ─────────────────────────────────────────────────────

def download_bike_reference(url: str, dest: str):
    """Bikez.com'dan KLE500 görselini indirir."""
    if os.path.exists(dest):
        print(f"✅ Motor referansı zaten mevcut: {dest}")
        return
    print(f"⬇️  KLE500 referans görseli indiriliyor: {url}")
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    with open(dest, "wb") as f:
        f.write(resp.content)
    size_kb = os.path.getsize(dest) / 1024
    print(f"✅ Motor görseli indirildi: {dest}  ({size_kb:.0f} KB)")


def upload_image_to_imgbb(image_path: str, label: str = "Görsel") -> str:
    """Fotoğrafı ImgBB'ye yükler ve public URL döndürür."""
    print(f"📸 {label} ImgBB'ye yükleniyor: {image_path}")
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    resp = requests.post(
        "https://api.imgbb.com/1/upload",
        data={"key": IMGBB_API_KEY, "image": b64},
        timeout=30
    )
    resp.raise_for_status()
    data = resp.json()
    url  = data["data"]["url"]
    print(f"✅ ImgBB URL: {url}")
    return url


def create_seedance2_task(face_url: str, bike_url: str, prompt: str) -> str:
    """Kie.ai Seedance 2 ile image-to-video görevi oluşturur (yüz + motor referanslı)."""
    print("\n🎬 Kie.ai Seedance 2 görevi oluşturuluyor (yüz + KLE500 referanslı)...")
    # image_url: birincil referans (motor tam görünüm)
    # face_url: karakter yüz referansı (bazı modeller ek alan kabul eder)
    payload = {
        "model": "bytedance/seedance-2",
        "input": {
            "prompt":          prompt,
            "aspect_ratio":    "9:16",
            "resolution":      "720p",
            "duration":        15,
            "generate_audio":  True,
            "web_search":      False,
            "image_url":       bike_url,     # ana referans: gerçek KLE500
            "reference_image_url": face_url  # yüz karakteri referansı
        }
    }
    resp = requests.post(f"{BASE_URL}/jobs/createTask", json=payload, headers=HEADERS, timeout=30)
    print(f"   HTTP {resp.status_code}: {resp.text[:400]}")
    resp.raise_for_status()
    task_id = resp.json().get("data", {}).get("taskId")
    if not task_id:
        raise RuntimeError(f"taskId alınamadı: {resp.text}")
    print(f"✅ Task ID: {task_id}")
    return task_id


def poll_task(task_id: str, timeout: int = 600, interval: int = 20) -> str:
    """Görev tamamlanana kadar poll eder, video URL'ini döndürür."""
    print(f"\n⏳ Video üretiliyor (max {timeout}s bekleniyor)...")
    deadline = time.time() + timeout
    attempt  = 0
    while time.time() < deadline:
        attempt += 1
        resp = requests.get(
            f"{BASE_URL}/jobs/recordInfo",
            params={"taskId": task_id},
            headers=HEADERS,
            timeout=20
        )
        resp.raise_for_status()
        data  = resp.json().get("data", {})
        state = (data.get("state") or "").lower()
        print(f"   [{attempt:>3}] Durum: {state or '(bekleniyor)'}")

        if state == "success":
            return _extract_url(data)
        elif "fail" in state or "error" in state:
            raise RuntimeError(f"Üretim başarısız: {resp.text[:400]}")

        time.sleep(interval)

    raise TimeoutError("Video üretimi zaman aşımına uğradı.")


def _extract_url(data: dict) -> str:
    """Başarılı yanıttan video URL'ini çıkarır."""
    raw = data.get("resultJson") or data.get("resultUrl") or data.get("url") or ""
    if isinstance(raw, str):
        try:
            obj = json.loads(raw)
            urls = obj.get("resultUrls", [])
            if urls:
                return urls[0]
            return obj.get("resultUrl") or obj.get("url") or ""
        except json.JSONDecodeError:
            # Belki doğrudan URL
            import re
            m = re.search(r"https?://\S+", raw)
            return m.group(0) if m else raw
    if isinstance(raw, dict):
        urls = raw.get("resultUrls", [])
        return urls[0] if urls else raw.get("resultUrl") or raw.get("url") or ""
    return str(raw)


def resolve_download_url(url: str) -> str:
    """Geçici (aiquickdraw.com) URL'lerini çözümler."""
    if not url or "aiquickdraw.com" not in url:
        return url
    print(f"🔗 URL çözümleniyor: {url[:80]}...")
    resp = requests.post(
        f"{BASE_URL}/common/download-url",
        json={"url": url},
        headers=HEADERS,
        timeout=15
    )
    resp.raise_for_status()
    direct = resp.json().get("data")
    if direct:
        print(f"✅ Çözümlendi: {direct[:80]}...")
        return direct
    return url


def download_video(video_url: str, out_path: str):
    """Videoyu indirir ve kaydeder."""
    print(f"\n⬇️  Video indiriliyor: {video_url[:80]}...")
    resp = requests.get(video_url, stream=True, timeout=120)
    resp.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"✅ Video kaydedildi: {out_path}  ({size_mb:.1f} MB)")


# ── Ana Akış ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Motorcu_Short -- Levent Gul x Kawasaki KLE500 (2006)")
    print("  Kie.ai Seedance 2  |  Image-to-Video  |  Dual Reference")
    print("=" * 60)

    # 1. KLE500 referans görselini indir
    download_bike_reference(BIKE_IMG_URL, BIKE_IMG_PATH)

    # 2. Motor görselini ImgBB'ye yükle (ana referans)
    bike_url = upload_image_to_imgbb(BIKE_IMG_PATH, label="KLE500 motor görseli")

    # 3. Yüz fotoğrafını yükle (karakter referansı)
    if not os.path.exists(FACE_IMG_PATH):
        sys.exit(f"Yuz fotografı bulunamadi: {FACE_IMG_PATH}")
    face_url = upload_image_to_imgbb(FACE_IMG_PATH, label="Levent yuz referansi")

    # 4. Video görevi oluştur (iki referanslı)
    task_id = create_seedance2_task(face_url, bike_url, VIDEO_PROMPT)

    # 5. Tamamlanmasını bekle
    video_url = poll_task(task_id, timeout=600, interval=20)
    print(f"\nHam video URL: {video_url}")

    # 6. Gerekirse URL çözümle
    video_url = resolve_download_url(video_url)

    # 7. İndir
    out_path = os.path.join(SCRIPT_DIR, "motorcu_levent_kle500_v2.mp4")
    download_video(video_url, out_path)

    print("\n" + "=" * 60)
    print(f"  TAMAMLANDI!")
    print(f"  Dosya: {out_path}")
    print(f"  URL  : {video_url}")
    print("=" * 60)


if __name__ == "__main__":
    main()
