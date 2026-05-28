"""
🔄 Revision Engine — Kapak Revizyon Motoru
============================================
Notion sayfasındaki feedback'leri okur, orijinal görseli analiz eder,
ve feedback doğrultusunda minimal değişiklikle yeni kapak üretir.

Kullanım:
    python3 revision_engine.py <page_id>
"""
import os
import sys
import json
import random
import requests
import base64
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
# master.env sadece lokal ortamda mevcut, Railway'de env variables direkt set edilir
_master_env = "ANTIGRAVITY_ROOT_BURAYA/_knowledge/credentials/master.env"
if os.path.exists(_master_env):
    load_dotenv(_master_env)

from notion_service import read_revision_feedback, update_feedback_block
from autonomous_cover_agent import (
    upload_to_imgbb,
    generate_cover_with_nanobanana,
    evaluate_image_with_vision,
    KIE_API_KEY,
    GEMINI_API_KEY,
)
from drive_service import upload_cover_to_drive

from google import genai
from google.genai import types as genai_types

try:
    client = genai.Client(api_key=GEMINI_API_KEY)
    _gemini_ready = True
except Exception as e:
    print(f"Warning: Failed to initialize Gemini: {e}")
    _gemini_ready = False


def download_image_from_url(url: str, output_path: str) -> bool:
    """Downloads an image from a URL (Drive web link or direct URL)."""
    try:
        # If it's a Drive link, convert to direct download
        if "drive.google.com" in url:
            file_id = None
            if "/file/d/" in url:
                file_id = url.split("/file/d/")[1].split("/")[0]
            elif "id=" in url:
                file_id = url.split("id=")[1].split("&")[0]
            
            if file_id:
                url = f"https://drive.google.com/uc?export=download&id={file_id}"
        
        resp = requests.get(url, timeout=30)
        if resp.status_code == 200 and len(resp.content) > 1000:
            with open(output_path, "wb") as f:
                f.write(resp.content)
            print(f"📥 Görsel indirildi: {output_path} ({len(resp.content)} bytes)")
            return True
        else:
            print(f"❌ İndirme başarısız: status={resp.status_code}, size={len(resp.content)}")
            return False
    except Exception as e:
        print(f"❌ İndirme hatası: {e}")
        return False


def analyze_existing_cover(image_path: str) -> str:
    """
    Gemini Vision ile mevcut kapağı analiz eder.
    Pozisyon, ışıklandırma, renk paleti, kıyafet, ifade, metin stili vb. detayları çıkarır.
    Bu analiz revize prompt'unda referans olarak kullanılır.
    """
    if not _gemini_ready:
        return "Analysis unavailable - Gemini not initialized"
    
    try:
        with open(image_path, "rb") as f:
            img_bytes = f.read()
        
        prompt = """Analyze this social media cover photo in EXTREME DETAIL. I need to recreate 
        a very similar image with minor modifications. Describe:
        
        1. **Person**: Exact pose, body framing (close-up/medium/full), face angle, expression, 
           eye direction, hand position if visible
        2. **Clothing**: Exact description of what the person is wearing (color, type, style)
        3. **Lighting**: Direction, quality, color temperature, shadows, highlights, rim light
        4. **Background/Scene**: Everything behind the person — setting, objects, atmosphere
        5. **Color Palette**: Dominant colors, grading style, contrast level, saturation
        6. **Text**: Exact text content, font style, size relative to image, position (center/top/bottom), 
           color, any effects (shadow, outline, glow)
        7. **Overall Mood**: Cinematic quality, film grain, depth of field
        8. **Composition**: Rule of thirds position, negative space usage
        
        Be VERY SPECIFIC — I will use this description to recreate the same image with only small changes.
        Return as a structured description, not JSON."""
        
        image_part = genai_types.Part.from_bytes(data=img_bytes, mime_type="image/png")
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                image_part,
                prompt
            ]
        )
        
        analysis = response.text
        print(f"📊 Görsel analizi tamamlandı ({len(analysis)} karakter)")
        return analysis
    
    except Exception as e:
        print(f"❌ Görsel analiz hatası: {e}")
        return f"Analysis failed: {e}"


def generate_revision_prompt(original_analysis: str, feedback: str, cover_text: str, 
                              person_image_url: str) -> str:
    """
    Orijinal görselin analizini ve kullanıcı feedback'ini birleştirerek
    minimal değişiklik yapan bir prompt oluşturur.
    """
    if not _gemini_ready:
        # Fallback: basit prompt
        return (
            f"Recreate this social media cover with the same style and composition. "
            f"The text must read: '{cover_text}'. "
            f"Apply this change: {feedback}. "
            f"Keep everything else exactly the same. --cref {person_image_url} --cw 0"
        )
    
    try:
        meta_prompt = f"""You are an expert at writing image generation prompts for Kie AI (Nano Banana Pro model).

I have an existing cover photo with this detailed analysis:
\"\"\"
{original_analysis}
\"\"\"

The user wants these specific changes:
\"\"\"
{feedback}
\"\"\"

The cover text MUST read: "{cover_text}"

Write a SINGLE detailed prompt that:
1. RECREATES the original image as closely as possible (same pose, lighting, scene, colors, mood)
2. ONLY changes what the user specifically asked for
3. Keeps everything else IDENTICAL to the original
4. Includes proper text rendering instructions for the Turkish text "{cover_text}"

IMPORTANT RULES:
- The text MUST be Turkish only, no English
- Text must be within Instagram 4:5 safe zone (not top/bottom 15%)
- Text must be LARGE (60-80% image width)
- Text must be written ONLY ONCE
- Include "--cref {person_image_url} --cw 0" at the end
- Use "CRITICAL FACE IDENTITY INSTRUCTION" at the start to lock face identity

Return ONLY the prompt text, nothing else."""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=meta_prompt
        )
        
        prompt = response.text.strip()
        
        # Ensure cref is appended
        if "--cref" not in prompt:
            prompt += f" --cref {person_image_url} --cw 0"
        
        print(f"📝 Revize prompt oluşturuldu ({len(prompt)} karakter)")
        return prompt
        
    except Exception as e:
        print(f"⚠️ Prompt üretim hatası, fallback kullanılıyor: {e}")
        return (
            f"Recreate this social media cover with the same style and composition. "
            f"The text must read: '{cover_text}'. "
            f"Apply this change: {feedback}. "
            f"Keep everything else exactly the same. --cref {person_image_url} --cw 0"
        )


def process_single_revision(feedback_entry: dict, drive_folder_url: str = None) -> bool:
    """
    Tek bir feedback entry'sini işler:
    1. Orijinal görseli Drive'dan indir
    2. Gemini Vision ile analiz et
    3. Feedback'e göre revize prompt oluştur
    4. Kie AI ile yeni görsel üret
    5. Drive'a yükle
    6. Notion'da feedback bloğunu güncelle
    
    Args:
        feedback_entry: read_revision_feedback()'ten dönen dict
        drive_folder_url: Kapağın Drive klasörü (yoksa feedback'teki link kullanılır)
    
    Returns:
        True if successful
    """
    theme_index = feedback_entry["theme_index"]
    theme_name = feedback_entry["theme_name"]
    cover_text = feedback_entry["cover_text"]
    feedback = feedback_entry["feedback"]
    drive_links = feedback_entry.get("drive_links", [])
    block_id = feedback_entry.get("block_id")
    
    print(f"\n{'='*60}")
    print(f"🔄 REVİZE: Tema {theme_index} ({theme_name}) — \"{cover_text}\"")
    print(f"   Feedback: {feedback}")
    print(f"{'='*60}")
    
    # 1. Download original cover
    original_path = f"/tmp/revision_original_T{theme_index}.png"
    original_downloaded = False
    
    if drive_links:
        for link in drive_links:
            if download_image_from_url(link, original_path):
                original_downloaded = True
                break
    
    # 2. Analyze original (if available)
    original_analysis = ""
    if original_downloaded:
        print("🔍 Orijinal kapak analiz ediliyor...")
        original_analysis = analyze_existing_cover(original_path)
        
        # Upload original to ImgBB for style reference
        original_imgbb_url = upload_to_imgbb(original_path)
    else:
        print("⚠️ Orijinal kapak indirilemedi, sıfırdan üretim yapılacak.")
        original_imgbb_url = None
    
    # 3. Select cutout for face reference
    cutout_dir = os.path.join(os.path.dirname(__file__), "assets", "cutouts")
    cutouts = [f for f in os.listdir(cutout_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    if not cutouts:
        print("❌ Cutout fotoğrafı bulunamadı!")
        if block_id: update_feedback_block(block_id, "Cutout fotoğrafı bulunamadı (sistem hatası).", is_error=True)
        return False
    
    cutout_path = os.path.join(cutout_dir, random.choice(cutouts))
    person_image_url = upload_to_imgbb(cutout_path)
    if not person_image_url:
        print("❌ Cutout ImgBB yüklemesi başarısız!")
        if block_id: update_feedback_block(block_id, "Yüz referansı (ImgBB) yüklenemedi.", is_error=True)
        return False
    
    # 4. Generate revision prompt
    print("📝 Revize prompt oluşturuluyor...")
    revision_prompt = generate_revision_prompt(
        original_analysis=original_analysis,
        feedback=feedback,
        cover_text=cover_text,
        person_image_url=person_image_url
    )
    
    # 5. Build reference image list (cutout + original for style)
    extra_refs = []
    if original_imgbb_url:
        extra_refs.append(original_imgbb_url)
    
    # 6. Generate revised cover
    print("🎨 Revize kapak üretiliyor...")
    generated_url = generate_cover_with_nanobanana(
        person_image_url, 
        revision_prompt,
        extra_ref_urls=extra_refs
    )
    
    if not generated_url:
        print("❌ Kapak üretimi başarısız!")
        if block_id: update_feedback_block(block_id, "Kapak üretimi başarısız oldu (Kie AI).", is_error=True)
        return False
    
    # 7. Evaluate
    with open(os.path.join(os.path.dirname(__file__), "rourke_style_guide.md"), "r") as f:
        style_guide = f.read()
    
    learnings = ""
    learnings_path = os.path.join(os.path.dirname(__file__), "learnings.md")
    if os.path.exists(learnings_path):
        with open(learnings_path, "r") as f:
            learnings = f.read()
    
    evaluation = evaluate_image_with_vision(generated_url, style_guide, cover_text, learnings)
    try:
        score = float(evaluation.get("score", 0))
    except (ValueError, TypeError):
        score = 0
    print(f"📊 Revize skoru: {score}/10")
    print(f"   Critique: {evaluation.get('critique', '')[:150]}")
    
    # 8. Download and save
    output_filename = f"kapak_T{theme_index}_{theme_name}_REV.png"
    output_path = os.path.join(os.path.dirname(__file__), "outputs", output_filename)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    img_data = requests.get(generated_url, timeout=60).content
    with open(output_path, "wb") as f:
        f.write(img_data)
    print(f"💾 Revize kapak kaydedildi: {output_path}")
    
    # 9. Upload to Drive
    if drive_folder_url:
        drive_file_name = f"Kapak T{theme_index} ({theme_name}) REV.png"
        upload_cover_to_drive(output_path, drive_folder_url, file_name=drive_file_name)
        print(f"☁️ Drive'a yüklendi: {drive_file_name}")
    
    # 10. Update Notion feedback block
    if block_id:
        revision_note = f"Skor: {score}/10 | {output_filename}"
        update_feedback_block(block_id, revision_note)
        print(f"✅ Notion feedback bloğu güncellendi")
    
    return True


def process_all_revisions(page_id: str, drive_folder_url: str = None) -> dict:
    """
    Bir Notion sayfasındaki tüm pending feedback'leri işler.
    
    Args:
        page_id: Notion page ID
        drive_folder_url: Drive KAPAK klasörü URL'i
    
    Returns:
        dict: {"total": N, "success": M, "failed": K}
    """
    print(f"\n📋 Revizyon feedback'leri okunuyor... (Page: {page_id})")
    feedbacks = read_revision_feedback(page_id)
    
    if not feedbacks:
        print("ℹ️ Bekleyen feedback bulunamadı.")
        return {"total": 0, "success": 0, "failed": 0}
    
    print(f"📦 {len(feedbacks)} adet feedback işlenecek.\n")
    
    results = {"total": len(feedbacks), "success": 0, "failed": 0}
    
    for fb in feedbacks:
        try:
            success = process_single_revision(fb, drive_folder_url)
            if success:
                results["success"] += 1
            else:
                results["failed"] += 1
        except Exception as e:
            print(f"❌ Revize hatası: {e}")
            results["failed"] += 1
    
    print(f"\n{'='*60}")
    print(f"📊 REVİZYON SONUÇLARI")
    print(f"   Toplam: {results['total']}")
    print(f"   Başarılı: {results['success']}")
    print(f"   Başarısız: {results['failed']}")
    print(f"{'='*60}")
    
    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Kullanım: python3 revision_engine.py <page_id> [drive_folder_url]")
        print("Örnek: python3 revision_engine.py abc123 https://drive.google.com/drive/folders/xyz")
        sys.exit(1)
    
    page_id = sys.argv[1]
    drive_url = sys.argv[2] if len(sys.argv) > 2 else None
    
    process_all_revisions(page_id, drive_url)
