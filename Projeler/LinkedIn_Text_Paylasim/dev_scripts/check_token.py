import requests
import os
from dotenv import load_dotenv

load_dotenv('../../_knowledge/credentials/master.env')

token = os.environ.get('LINKEDIN_ACCESS_TOKEN')
headers = {
    "Authorization": f"Bearer {token}",
    "LinkedIn-Version": "202604",
    "X-Restli-Protocol-Version": "2.0.0"
}

def check_token():
    # Try to get own profile (User Info API)
    url = "https://api.linkedin.com/v2/userinfo"
    resp = requests.get(url, headers=headers)
    print(f"UserInfo API Status: {resp.status_code}")
    print(f"UserInfo Body: {resp.text}")
    
    # Try to get own profile (Me API)
    url = "https://api.linkedin.com/v2/me"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    print(f"Me API Status: {resp.status_code}")
    print(f"Me Body: {resp.text}")

if __name__ == "__main__":
    check_token()
