import requests
import os
from dotenv import load_dotenv

load_dotenv('../../_knowledge/credentials/master.env')

token = os.environ.get('LINKEDIN_ACCESS_TOKEN')
person_urn = os.environ.get('LINKEDIN_PERSON_URN')

def test_shares_api():
    # Simplest legacy shares API
    url = "https://api.linkedin.com/v2/shares"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0"
    }
    
    payload = {
        "owner": person_urn,
        "subject": "Antigravity Test",
        "text": {
            "text": "Antigravity LinkedIn Otomasyon Testi: Diageo Türkiye gelişmelerini takip ediyoruz."
        },
        "distribution": {
            "linkedInDistributionMode": "MAIN_FEED"
        }
    }
    
    resp = requests.post(url, headers=headers, json=payload)
    print(f"Shares API Status: {resp.status_code}")
    print(f"Shares API Body: {resp.text}")

if __name__ == "__main__":
    test_shares_api()
