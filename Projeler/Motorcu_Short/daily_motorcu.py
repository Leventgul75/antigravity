"""
Motorcu_Short — Gunluk Otomasyon Orkestratoru
Her sabah 05:00'da calisir:
  1. Bugune ozel sahneyi secer (12 rotasyonlu)
  2. Kie.ai Seedance 2 ile video uretir (KLE500 + Levent yuz referansi)
  3. Instagram Reels, TikTok ve YouTube Shorts'a yukler
  4. Sonucu logs/daily_log.jsonl dosyasina kaydeder

Calistirma:
  python daily_motorcu.py              -> Bugünun sahnesi ile calistir
  python daily_motorcu.py --scene ege_turkey  -> Belirli bir sahneyi sec
  python daily_motorcu.py --list       -> Tum sahneleri listele
  python daily_motorcu.py --dry-run    -> Video uret, yayinlama
"""

import os
import sys
import json
import time
import base64
import argparse
import requests
from datetime import datetime
from pathlib import Path

# Proje ici moduller
from scenes_library import SCENES, get_todays_scene, get_random_scene, build_full_prompt
from publisher import Publisher

# ── Sabitler ──────────────────────────────────────────────────────────────────
KIE_API_KEY   = os.getenv("KIE_API_KEY")   or "5b3f6046a01602bde7abbc736a73ac3e"
IMGBB_API_KEY = os.getenv("IMGBB_API_KEY") or "5b21d477031954572b791600e969977a"

BASE_URL = "https://api.kie.ai/api/v1"
HEADERS  = {
    "Authorization": f"Bearer {KIE_API_KEY}",
    "Content-Type":  "application/json"
}

SCRIPT_DIR    = Path(__file__).parent
# Railway'de yuz fotografi env var'dan URL olarak gelir, yoksa yerel yolu dene
FACE_IMG_URL_ENV = os.getenv("FACE_IMG_URL")   # Railway: ImgBB URL
FACE_IMG_PATH_LOCAL = Path(os.getenv("FACE_IMG_PATH", r"C:\Users\levent\.gemini\antigravity\knowledge\lgai-marka-gorselleri\artifacts\levent_gul_yuz_referans.jpg"))
BIKE_IMG_PATH = SCRIPT_DIR / "kle500_reference.jpg"
BIKE_IMG_URL  = "https://bikez.com/pictures/kawasaki/2006/23879_0_1_4_kle%20500_Image%20credits%20-%20Kawasaki.jpg"
LOGS_DIR      = SCRIPT_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)
LOG_FILE      = LOGS_DIR / "daily_log.jsonl"

# ImgBB cache — aynı gün tekrar calistirmada yeniden upload etme
IMGBB_CACHE_FILE = SCRIPT_DIR / ".imgbb_cache.json"


# ── ImgBB Cache ───────────────────────────────────────────────────────────────
def load_imgbb_cache() -> dict:
    if IMGBB_CACHE_FILE.exists():
        try:
            return json.loads(IMGBB_CACHE_FILE.read_text("utf-8"))
        except Exception:
            pass
    return {}


def save_imgbb_cache(cache: dict):
    IMGBB_CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def upload_to_imgbb(image_path: Path, label: str, cache: dict) -> str:
    key = str(image_path)
    if key in cache:
        print(f"  [CACHE] {label}: {cache[key]}")
        return cache[key]
    print(f"  Yukleniyor {label} -> ImgBB: {image_path.name}")
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    resp = requests.post(
        "https://api.imgbb.com/1/upload",
        data={"key": IMGBB_API_KEY, "image": b64},
        timeout=30
    )
    resp.raise_for_status()
    url = resp.json()["data"]["url"]
    cache[key] = url
    save_imgbb_cache(cache)
    print(f"  OK {label}: {url}")
    return url


# ── Kie.ai Fonksiyonlari ──────────────────────────────────────────────────────
def download_bike_reference():
    if BIKE_IMG_PATH.exists():
        return
    print(f"  KLE500 referansi indiriliyor...")
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    resp = requests.get(BIKE_IMG_URL, headers=headers, timeout=30)
    resp.raise_for_status()
    BIKE_IMG_PATH.write_bytes(resp.content)
    print(f"  OK: {BIKE_IMG_PATH.name}  ({BIKE_IMG_PATH.stat().st_size // 1024} KB)")


def create_seedance2_task(face_url: str, bike_url: str, prompt: str) -> str:
    payload = {
        "model": "bytedance/seedance-2",
        "input": {
            "prompt":               prompt,
            "aspect_ratio":         "9:16",
            "resolution":           "720p",
            "duration":             15,
            "generate_audio":       True,
            "web_search":           False,
            "image_url":            bike_url,
            "reference_image_url":  face_url
        }
    }
    resp = requests.post(f"{BASE_URL}/jobs/createTask", json=payload, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    task_id = resp.json().get("data", {}).get("taskId")
    if not task_id:
        raise RuntimeError(f"taskId alinamadi: {resp.text}")
    print(f"  Task ID: {task_id}")
    return task_id


def poll_task(task_id: str, timeout: int = 600, interval: int = 20) -> str:
    deadline = time.time() + timeout
    attempt  = 0
    while time.time() < deadline:
        attempt += 1
        resp  = requests.get(f"{BASE_URL}/jobs/recordInfo", params={"taskId": task_id}, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        data  = resp.json().get("data", {})
        state = (data.get("state") or "").lower()
        print(f"  [{attempt:>3}] Durum: {state or '(bekleniyor)'}")
        if state == "success":
            return _extract_url(data)
        elif "fail" in state or "error" in state:
            raise RuntimeError(f"Uretim basarisiz: {resp.text[:300]}")
        time.sleep(interval)
    raise TimeoutError("Video uretimi zaman asimina ugradi.")


def _extract_url(data: dict) -> str:
    import json as _json, re
    raw = data.get("resultJson") or data.get("resultUrl") or data.get("url") or ""
    if isinstance(raw, str):
        try:
            obj = _json.loads(raw)
            urls = obj.get("resultUrls", [])
            if urls:
                return urls[0]
            return obj.get("resultUrl") or obj.get("url") or ""
        except Exception:
            m = re.search(r"https?://\S+", raw)
            return m.group(0) if m else raw
    if isinstance(raw, dict):
        urls = raw.get("resultUrls", [])
        return urls[0] if urls else raw.get("resultUrl") or raw.get("url") or ""
    return str(raw)


def resolve_download_url(url: str) -> str:
    if not url or "aiquickdraw.com" not in url:
        return url
    resp = requests.post(f"{BASE_URL}/common/download-url", json={"url": url}, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json().get("data") or url


def download_video(video_url: str, out_path: Path):
    print(f"  Indiriliyor: {video_url[:80]}...")
    resp = requests.get(video_url, stream=True, timeout=120)
    resp.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"  Kaydedildi: {out_path.name}  ({size_mb:.1f} MB)")


# ── Loglama ───────────────────────────────────────────────────────────────────
def write_log(entry: dict):
    entry["logged_at"] = datetime.now().isoformat()
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"  Log yazildi: {LOG_FILE}")


# ── Ana Is Akisi ──────────────────────────────────────────────────────────────
def run(scene: dict, dry_run: bool = False):
    run_date   = datetime.now().strftime("%Y-%m-%d")
    scene_id   = scene["id"]
    title      = scene["title_tr"]
    description = f"{scene['desc_tr']}\n\n{scene['hashtags']}"
    prompt     = build_full_prompt(scene)

    print("\n" + "=" * 60)
    print(f"  Motorcu_Short | Gunluk Otomasyon")
    print(f"  Tarih  : {run_date}")
    print(f"  Sahne  : {title} ({scene_id})")
    print("=" * 60)

    # 1. Referanslari hazirla
    print("\n[1] Referans gorseller hazırlaniyor...")
    download_bike_reference()
    cache    = load_imgbb_cache()
    bike_url = upload_to_imgbb(BIKE_IMG_PATH, "KLE500 motor", cache)

    # Yuz fotografi: Railway'de FACE_IMG_URL env var, lokalde dosya yolu
    if FACE_IMG_URL_ENV:
        face_url = FACE_IMG_URL_ENV
        print(f"  [ENV] Yuz URL: {face_url}")
    elif FACE_IMG_PATH_LOCAL.exists():
        face_url = upload_to_imgbb(FACE_IMG_PATH_LOCAL, "Levent yuz", cache)
    else:
        raise FileNotFoundError(
            "Yuz fotografi bulunamadi!\n"
            "Railway'de FACE_IMG_URL env var'ini ayarlayin.\n"
            f"Lokal: {FACE_IMG_PATH_LOCAL}"
        )

    # 2. Video uret
    print(f"\n[2] Seedance 2 video uretimi baslıyor...")
    print(f"    Prompt ({len(prompt)} karakter): {prompt[:120]}...")
    task_id   = create_seedance2_task(face_url, bike_url, prompt)
    video_url = poll_task(task_id, timeout=600, interval=20)
    video_url = resolve_download_url(video_url)

    # 3. Kaydet
    out_path  = SCRIPT_DIR / f"output_{run_date}_{scene_id}.mp4"
    download_video(video_url, out_path)

    # 4. Yayinla
    publish_results = {}
    if dry_run:
        print("\n[3] DRY-RUN modu — yayinlama atlandi.")
    else:
        print("\n[3] Platformlara yayinlaniyor...")
        publisher        = Publisher()
        publish_results  = publisher.publish_all(str(out_path), title, description)

    # 5. Logla
    print("\n[4] Log yazilıyor...")
    log_entry = {
        "date":            run_date,
        "scene_id":        scene_id,
        "title":           title,
        "video_file":      str(out_path),
        "video_url":       video_url,
        "task_id":         task_id,
        "dry_run":         dry_run,
        "publish_results": publish_results,
    }
    write_log(log_entry)

    print("\n" + "=" * 60)
    print("  TAMAMLANDI!")
    print(f"  Dosya : {out_path}")
    if not dry_run:
        for p, r in publish_results.items():
            print(f"  {p:12s}: {'OK' if r.get('success') else 'HATA'}")
    print("=" * 60)
    return log_entry


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Motorcu_Short Gunluk Otomasyon")
    parser.add_argument("--scene",   help="Belirli bir sahne ID'si sec (ör: route66_desert)")
    parser.add_argument("--list",    action="store_true", help="Tum sahneleri listele")
    parser.add_argument("--dry-run", action="store_true", help="Video uret, yayinlama")
    args = parser.parse_args()

    if args.list:
        print("\nMevcut sahneler:")
        for i, s in enumerate(SCENES, 1):
            print(f"  {i:>2}. {s['id']:30s} — {s['title_tr']}")
        return

    if args.scene:
        scene_map = {s["id"]: s for s in SCENES}
        if args.scene not in scene_map:
            sys.exit(f"Bilinmeyen sahne ID: {args.scene}\n--list ile gecerli sahneleri gorebilirsin.")
        scene = scene_map[args.scene]
    else:
        scene = get_todays_scene()

    run(scene, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
