import requests
import os
from dotenv import load_dotenv

load_dotenv('../../_knowledge/credentials/master.env')

token = os.environ.get('LINKEDIN_ACCESS_TOKEN')
# NEW NUMERIC URN FOUND BY SUBAGENT
person_urn = "urn:li:member:6899045044465016833"

def test_ugc_post_numeric():
    url = "https://api.linkedin.com/v2/ugcPosts"
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json"
    }
    
    payload = {
        "author": person_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {
                    "text": "Antigravity LinkedIn Otomasyon Testi (Sayısal URN): Diageo Türkiye ve Global gelişmelerini takip etmeye devam ediyoruz. #LGAI #Diageo"
                },
                "shareMediaCategory": "NONE"
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
    }
    
    resp = requests.post(url, headers=headers, json=payload)
    print(f"UGC API Status: {resp.status_code}")
    print(f"UGC API Body: {resp.text}")

if __name__ == "__main__":
    test_ugc_post_numeric()
