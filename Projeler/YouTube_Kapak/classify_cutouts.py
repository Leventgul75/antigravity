import os
import glob
import json
import base64
from dotenv import load_dotenv

# SDK Compatibility Layer
_USE_NEW_SDK = False
try:
    from google import genai
    _USE_NEW_SDK = True
except ImportError:
    try:
        import google.generativeai as genai_legacy
    except ImportError:
        genai_legacy = None

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "_knowledge", "credentials", "master.env"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

client = None
if _USE_NEW_SDK:
    client = genai.Client(api_key=GEMINI_API_KEY)
elif genai_legacy:
    genai_legacy.configure(api_key=GEMINI_API_KEY)
    client = True

# Resolve cutouts directory: local project first, then shared Reels project
_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCAL_CUTOUTS = os.path.join(_PROJECT_DIR, "assets", "cutouts")
_SHARED_CUTOUTS = os.path.join(os.path.dirname(_PROJECT_DIR), "Reels_Kapak", "assets", "cutouts")
CUTOUTS_DIR = _LOCAL_CUTOUTS if os.path.exists(_LOCAL_CUTOUTS) else _SHARED_CUTOUTS

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def classify_cutouts():
    cutouts = glob.glob(os.path.join(CUTOUTS_DIR, "*.png"))
    
    tags_db = {}
    total = len(cutouts)
    
    for idx, path in enumerate(cutouts):
        filename = os.path.basename(path)
        print(f"Classifying {idx+1}/{total}: {filename}")
        
        try:
            mime_type = "image/png"
            image_data = {"mime_type": mime_type, "data": encode_image(path)}
            prompt = "Look at this person's facial expression and hand gestures. Describe the mood/action in 1-2 words from this list ONLY: [confident, curious, surprised, pointing, happy, serious, mysterious]. Return ONLY the single most fitting word."
            if _USE_NEW_SDK:
                from google.genai import types
                image_bytes = open(path, "rb").read()
                image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[image_part, prompt]
                )
            else:
                model = genai_legacy.GenerativeModel("gemini-2.5-flash")
                response = model.generate_content([image_data, prompt])
            tag = response.text.strip().lower()
            
            # fallback matching
            valid_tags = ['confident', 'curious', 'surprised', 'pointing', 'happy', 'serious', 'mysterious']
            final_tag = 'confident'
            for vt in valid_tags:
                if vt in tag:
                    final_tag = vt
                    break
                    
            tags_db[filename] = final_tag
            print(f" -> {final_tag}")
        except Exception as e:
            print(f"Error on {filename}: {e}")
            tags_db[filename] = 'confident'
            
    with open("cutout_tags.json", "w") as f:
        json.dump(tags_db, f, indent=4)
    print("Saved cutout_tags.json")

if __name__ == "__main__":
    classify_cutouts()
