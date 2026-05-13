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

def list_orgs():
    # Organization Acls endpoint
    url = "https://api.linkedin.com/rest/organizationAcls?q=roleContext"
    resp = requests.get(url, headers=headers)
    print(f"Orgs API Status: {resp.status_code}")
    print(f"Orgs API Body: {resp.text}")

if __name__ == "__main__":
    list_orgs()
