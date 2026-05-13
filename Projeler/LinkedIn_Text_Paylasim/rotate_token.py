"""
LinkedIn token rotasyon yardımcısı — 60 günlük token bittiğinde kullan.

Kullanım:
    1. https://www.linkedin.com/developers/tools/oauth/token-generator → app seç
       → scope: openid, profile, email, w_member_social → Request access token
    2. Yeni token'ı master.env'deki LINKEDIN_ACCESS_TOKEN değerine yapıştır
    3. python rotate_token.py

Bu script:
    - /v2/userinfo'ya çağrı yapıp token'ın gerçekten yaşadığını doğrular
    - Token sahibinin gerçek member URN'ini (sub) bulur
    - master.env'deki LINKEDIN_PERSON_URN'i otomatik günceller
    - HİÇ post atmaz — güvenli sağlık kontrolü ve env senkronizasyonudur

Canlı bir test postu atmak için: dev_scripts/test_live_post.py
"""
import os
import re
import sys
import requests
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.normpath(
    os.path.join(ROOT, "..", "..", "_knowledge", "credentials", "master.env")
)

if not os.path.exists(ENV_PATH):
    sys.exit(f"master.env bulunamadı: {ENV_PATH}")

load_dotenv(ENV_PATH)
TOKEN = os.environ.get("LINKEDIN_ACCESS_TOKEN", "")
if not TOKEN:
    sys.exit("LINKEDIN_ACCESS_TOKEN env'de boş.")

print(f"[1/3] Token uzunluğu: {len(TOKEN)} char, ilk 8: {TOKEN[:8]}...")

# 1) userinfo ile token'ın geçerliliğini ve sahibini bul
print("[2/3] /v2/userinfo çağrılıyor...")
r = requests.get(
    "https://api.linkedin.com/v2/userinfo",
    headers={"Authorization": f"Bearer {TOKEN}"},
    timeout=15,
)
if r.status_code != 200:
    print(f"  ❌ Status {r.status_code}: {r.text[:300]}")
    sys.exit(
        "Token geçersiz veya 'openid profile email' scope'u yok.\n"
        "LinkedIn Developer Console'dan yeni token üret ve master.env'e yapıştır."
    )

data = r.json()
sub = data.get("sub")
name = data.get("name")
email = data.get("email")
if not sub:
    sys.exit(f"  ❌ userinfo response'unda 'sub' yok: {data}")

person_urn = f"urn:li:person:{sub}"
print(f"  ✅ Token sahibi: {name} ({email})")
print(f"  ✅ Member URN  : {person_urn}")

# 2) master.env'i güncelle
print("[3/3] master.env güncelleniyor...")
with open(ENV_PATH, "r", encoding="utf-8") as f:
    txt = f.read()

current = re.search(r"LINKEDIN_PERSON_URN=(.*)", txt)
current_val = current.group(1).strip() if current else None

if current_val == person_urn:
    print(f"  ℹ️  LINKEDIN_PERSON_URN zaten doğru, güncelleme gerekmedi.")
else:
    new_txt = re.sub(r"LINKEDIN_PERSON_URN=.*", f"LINKEDIN_PERSON_URN={person_urn}", txt)
    if new_txt == txt:
        new_txt = txt.rstrip() + f"\nLINKEDIN_PERSON_URN={person_urn}\n"
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.write(new_txt)
    print(f"  ✅ Güncellendi: {current_val} → {person_urn}")

print("\n" + "=" * 60)
print("✅ Token sağlıklı. Bir sonraki cron tetiklemesinde post otomatik atılacak.")
print("   Railway'e deploy ediyorsan env vars'ı da güncellemeyi unutma.")
print("=" * 60)
