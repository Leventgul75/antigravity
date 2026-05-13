"""
LinkedIn token tanı scripti — 403 hatasının kök nedenini bulmak için.

4 endpoint'e dokunur:
  1. /oauth/v2/introspectToken  → token aktif mi, scope'lar neler
  2. /v2/userinfo (OpenID)       → 'openid profile email' scope kontrolü
  3. /rest/me (versioned)        → versioned API erişimi var mı
  4. /v2/ugcPosts (legacy write) → w_member_social scope hayatta mı (kuru deneme: validateOnly yok ama başlatır)
"""
import os
import requests
from dotenv import load_dotenv

# Master env'i yükle (config.py'deki ile aynı yol)
env_path = os.path.join(os.path.dirname(__file__), "..", "..", "_knowledge", "credentials", "master.env")
load_dotenv(env_path)

TOKEN = os.environ.get("LINKEDIN_ACCESS_TOKEN", "")
PERSON_URN = os.environ.get("LINKEDIN_PERSON_URN", "")

print(f"Token uzunluğu: {len(TOKEN)} char")
print(f"Person URN     : {PERSON_URN}")
print("=" * 60)

# 1) introspectToken — scope ve expiry öğren
print("\n[1] /oauth/v2/introspectToken")
try:
    r = requests.post(
        "https://www.linkedin.com/oauth/v2/introspectToken",
        data={"token": TOKEN},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    print(f"  Status: {r.status_code}")
    print(f"  Body  : {r.text[:600]}")
except Exception as e:
    print(f"  EXC: {e}")

# 2) /v2/userinfo
print("\n[2] /v2/userinfo (OpenID)")
try:
    r = requests.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=15,
    )
    print(f"  Status: {r.status_code}")
    print(f"  Body  : {r.text[:400]}")
except Exception as e:
    print(f"  EXC: {e}")

# 3) /rest/me (versioned)
print("\n[3] /rest/me (LinkedIn-Version: 202604)")
try:
    r = requests.get(
        "https://api.linkedin.com/rest/me",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "LinkedIn-Version": "202604",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        timeout=15,
    )
    print(f"  Status: {r.status_code}")
    print(f"  Body  : {r.text[:400]}")
except Exception as e:
    print(f"  EXC: {e}")

# 4) /v2/ugcPosts — gerçek paylaşım denemesi (legacy write API, w_member_social gerektirir)
print("\n[4] /v2/ugcPosts — REAL POST (w_member_social scope kontrolü)")
try:
    r = requests.post(
        "https://api.linkedin.com/v2/ugcPosts",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
        },
        json={
            "author": PERSON_URN,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {
                        "text": "🧪 Antigravity LinkedIn otomasyon tanı testi — ugcPosts endpoint."
                    },
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        },
        timeout=20,
    )
    print(f"  Status: {r.status_code}")
    print(f"  Headers x-restli-id: {r.headers.get('x-restli-id', '')}")
    print(f"  Body  : {r.text[:600]}")
    if r.status_code in (200, 201):
        post_id = r.headers.get("x-restli-id", "")
        print(f"\n  ✅ ugcPosts BAŞARILI! URL: https://www.linkedin.com/feed/update/{post_id}/")
except Exception as e:
    print(f"  EXC: {e}")

print("\n" + "=" * 60)
print("YORUM REHBERİ:")
print("  [1] 200 → scope listesi gözüküyor; 'w_member_social' var mı bak.")
print("  [1] 401/expired → token süresi dolmuş, yenile.")
print("  [2] 200 → token genel olarak yaşıyor.")
print("  [2] 401 → token tamamen geçersiz.")
print("  [3] 200 → versioned API erişimi var.")
print("  [4] 201 → gerçek post atıldı, x-restli-id'yi al.")
print("  [4] 403 → w_member_social scope eksik veya app onaylı değil.")
