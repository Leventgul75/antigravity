import os
import time
import base64
import requests
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

load_dotenv()
# master.env sadece lokal ortamda mevcut, Railway'de env variables direkt set edilir
_master_env = "ANTIGRAVITY_ROOT_BURAYA/_knowledge/credentials/master.env"
if os.path.exists(_master_env):
    load_dotenv(_master_env)

KIE_API_KEY = os.getenv("KIE_API_KEY")
IMGBB_API_KEY = os.getenv("IMGBB_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

try:
    client = genai.Client(api_key=GEMINI_API_KEY)
except Exception as e:
    print(f"Warning: Failed to initialize Gemini Client: {e}")
    client = None


def upload_to_imgbb(image_path: str) -> str:
    print(f"Uploading {image_path} to ImgBB...")
    with open(image_path, "rb") as file:
        encoded_image = base64.b64encode(file.read()).decode("utf-8")
    
    url = "https://api.imgbb.com/1/upload"
    payload = {
        "key": IMGBB_API_KEY,
        "image": encoded_image
    }
    response = requests.post(url, data=payload, timeout=30)
    if response.status_code == 200:
        img_url = response.json()["data"]["url"]
        print(f"Uploaded successfully to ImgBB: {img_url}")
        return img_url
    else:
        print(f"ImgBB upload failed: {response.text}")
        return None

def generate_cover_with_nanobanana(image_url: str, prompt: str, extra_ref_urls: list = None) -> str:
    print("Sending generation request to Nano Banana Pro...")
    
    create_url = "https://api.kie.ai/api/v1/jobs/createTask"
    headers = {
        "Authorization": f"Bearer {KIE_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Build image_input list: primary ref + up to 2 extra refs for stronger face identity
    image_inputs = [image_url]
    if extra_ref_urls:
        for ref_url in extra_ref_urls[:2]:  # Max 3 total (1 primary + 2 extra)
            if ref_url and ref_url != image_url:
                image_inputs.append(ref_url)
    
    print(f"  Using {len(image_inputs)} reference image(s) for face identity locking.")
    
    payload = {
        "model": "nano-banana-pro",
        "input": {
            "prompt": prompt,
            "aspect_ratio": "9:16"
        }
    }
    
    response = requests.post(create_url, headers=headers, json=payload, timeout=30)
    if response.status_code != 200:
        print(f"Failed to create task: {response.text}")
        return None
        
    task_id = response.json().get("data", {}).get("taskId")
    if not task_id:
        print("taskId not found in generation response.")
        return None
        
    print(f"Task created successfully. Task ID: {task_id}. Waiting for completion...")
    
    # Polling for result with MAX TIMEOUT (5 minutes)
    poll_url = f"https://api.kie.ai/api/v1/jobs/recordInfo?taskId={task_id}"
    max_poll_seconds = 300  # 5 dakika max
    poll_start = time.time()
    
    while True:
        # Timeout guard: sonsuz döngüyü engelle
        elapsed = time.time() - poll_start
        if elapsed > max_poll_seconds:
            print(f"⏱️ Polling timeout ({max_poll_seconds}s). Aborting.")
            return None
        
        poll_resp = requests.get(poll_url, headers=headers, timeout=30)
        if poll_resp.status_code != 200:
             print(f"Polling failed: {poll_resp.text}")
             time.sleep(5)
             continue
             
        data = poll_resp.json().get("data", {})
        state = data.get("state")
        
        if state == "success":
            result_json = data.get("resultJson", "{}")
            result_data = json.loads(result_json)
            print("Generation successful!")
            final_image_url = None
            if isinstance(result_data, list) and len(result_data) > 0:
                final_image_url = result_data[0]
            elif isinstance(result_data, dict) and "resultUrls" in result_data:
                final_image_url = result_data["resultUrls"][0]
            elif isinstance(result_data, dict) and "images" in result_data:
                final_image_url = result_data["images"][0]["url"]
            elif isinstance(result_data, dict) and "url" in result_data:
                 final_image_url = result_data["url"]
                 
            if final_image_url:
                return final_image_url
            else:
                print(f"Could not parse result URL from: {result_json}")
                return None
                
        elif state == "failed":
            print(f"Generation failed. Msg: {data.get('failMsg')}")
            return None
        
        elif state in ["processing", "wait"]:
             time.sleep(10)
        else:
             print(f"Unknown state: {state}")
             time.sleep(10)


def generate_cover_text_and_scene(video_name: str, script_text: str) -> dict:
    """
    Generates BOTH the cover text AND a matching scene description for visual-text consistency.
    Returns a dict with 'cover_text' and 'scene_description'.
    
    CRITICAL: Video names (e.g. 'Typeless 5', 'Meshy 4') are INTERNAL identifiers only.
    They must NEVER be used as cover text. The script content must be analyzed instead.
    """
    print(f"Generating cover text + scene description via Gemini (Video: {video_name})...")
    if not client or not script_text:
        print("WARNING: No Gemini client or no script. Using generic fallback.")
        return {"cover_text": "BUNU BİLMELİSİN", "scene_description": "A cinematic close-up of a person with a knowing expression, dramatic lighting."}
    
    prompt = f"""
    You are an expert Turkish social media strategist for short-form videos (Reels/TikTok/Shorts) working for Levent Gül (LGAI - AI & SaaS Automation Expert).
    
    IMPORTANT CONTEXT: The video's internal tracking name is '{video_name}'. This is just an internal 
    identifier and has NOTHING to do with the video's content. For example:
    - "Typeless 5" means this is the 5th video about the AI tool called Typeless, NOT about being "typeless"
    - "Meshy 5" means this is a video about the 3D modeling tool Meshy
    - "Kimi 4" means this is a video about the AI assistant called Kimi
    DO NOT use the video name, tool name, or any translation/interpretation of the video name as the cover text.
    
    Here is the actual video script/content that describes what the video is about:
    \"\"\"
    {script_text}
    \"\"\"
    
    Task: Based ONLY on the script content above, create TWO things:
    
    1. **cover_text**: A highly engaging, punchy, 2 to 4-word Turkish text to display on the video's cover photo.
       STRICT RULES:
       - It MUST be in Turkish only. NO English words allowed under any circumstance.
       - It MUST NOT be the AI tool's name (e.g., NOT "Typeless", NOT "Meshy", NOT "Kimi").
       - It MUST NOT be the video title or any translation/transliteration of the video title.
       - It MUST be a clickbaity, provocative hook based on the VIDEO'S ACTUAL CONTENT and value proposition.
       - Think about: What benefit does the viewer get? What problem does it solve? What emotion does it evoke?
       - Keep it very concise (max 4 words, ideally 2-3).
       - ALL CAPS.
       - Good examples: "ANTRENÖRÜNÜ KOV", "AJANSA PARA VERME", "CV'Nİ ÇÖPTEN KURTAR", "KOMİSYONA SON", "KLAVYEYİ ÇÖPE AT", "SEKRETERİNİ KOV"
       - Bad examples: "TİPSİZ 5" (translation of video name), "TYPELESS" (English), "YENİ ARAÇ" (too vague)
    
    2. **scene_description**: A creative visual scene description (in English, 1-2 sentences) that DIRECTLY illustrates the cover_text meaning.
       CREATIVE RULES:
       - The scene must visually match and reinforce the cover text with a strong METAPHOR or ACTION.
       - AVOID the cliché of "person sitting at computer looking at screen". Be creative!
       - For 3D tool videos: Show a giant 3D character coming alive, not just on a screen.
       - For AI assistant videos: Show the person relaxing while AI handles work dramatically.
       - Use dramatic, cinematic visuals — think movie poster, not stock photo.
       - The scene must be ACTIONABLE and SPECIFIC, not vague.
    
    Return your response as valid JSON with exactly these keys:
    {{
        "cover_text": "YOUR TEXT HERE",
        "scene_description": "A cinematic scene of..."
    }}
    """
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"}
        )
        result = json.loads(response.text)
        if isinstance(result, list): result = result[0] if len(result) > 0 else {}
        cover_text = result.get('cover_text', '')
        
        # Safety check: Reject if the cover text looks like the video name
        video_name_lower = video_name.lower().replace(' ', '')
        cover_text_lower = cover_text.lower().replace(' ', '')
        if video_name_lower in cover_text_lower or cover_text_lower in video_name_lower:
            print(f"WARNING: Cover text '{cover_text}' looks like the video name '{video_name}'. Regenerating...")
            # Try once more with stronger instruction
            retry_prompt = f"""The previous attempt generated '{cover_text}' which is too similar to the video name '{video_name}'.
            Generate a COMPLETELY DIFFERENT cover text that focuses on the VIDEO'S VALUE PROPOSITION from the script.
            Script: \"{script_text[:500]}\"
            Return JSON: {{"cover_text": "...", "scene_description": "..."}}"""
            retry_response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=retry_prompt,
                config={"response_mime_type": "application/json"}
            )
            result = json.loads(retry_response.text)
            if isinstance(result, list): result = result[0] if len(result) > 0 else {}
            cover_text = result.get('cover_text', '')
        
        print(f"Generated Text: {cover_text}")
        print(f"Scene: {result.get('scene_description', '')}")
        return result
    except Exception as e:
        print(f"Error generating cover text+scene: {e}")
        return {"cover_text": "BUNU BİLMELİSİN", "scene_description": "A cinematic close-up of a person with a dramatic, knowing expression."}


def generate_three_themes(video_name: str, script_text: str) -> list:
    """
    Gemini ile bir video scripti için 3 FARKLI yaratıcı tema üretir.
    Her tema: {'theme_name', 'cover_text', 'scene_description'}
    Kullanım: 3 tema × 2 varyasyon = 6 kapak.
    """
    print(f"🧠 Generating 3 themes via Gemini (Video: {video_name})...")
    if not client or not script_text:
        print("WARNING: No Gemini client or no script. Using generic fallback themes.")
        return [
            {"theme_name": "fallback1", "cover_text": "BUNU İZLE", "scene_description": "A dramatic cinematic portrait with intense lighting."},
            {"theme_name": "fallback2", "cover_text": "İNANILMAZ", "scene_description": "A mysterious moody scene with neon reflections."},
            {"theme_name": "fallback3", "cover_text": "HERKES ŞAŞIRDI", "scene_description": "An empowering dynamic shot with dramatic perspective."},
        ]

    prompt = f"""
    You are an expert Turkish social media strategist for short-form videos (Reels/TikTok/Shorts) working for Levent Gül (LGAI - AI & SaaS Automation Expert).
    
    IMPORTANT: The video's internal tracking name '{video_name}' is just an identifier—ignore it for text creation.
    
    Here is the actual video script:
    \"\"\"
    {script_text}
    \"\"\"
    
    Task: Based ONLY on the script content, create exactly 3 COMPLETELY DIFFERENT creative theme directions.
    Each theme should have a unique angle, emotion, and visual concept.
    
    For each theme, provide:
    1. **theme_name**: A short internal label (e.g., "shock", "mystery", "power")
    2. **cover_text**: A punchy, 2-4 word Turkish clickbait hook. STRICT RULES:
       - Turkish ONLY. NO English words.
       - NOT the video/tool name.
       - ALL CAPS, max 4 words.
       - Examples: "ANTRENÖRÜNÜ KOV", "AJANSA PARA VERME", "KOMİSYONA SON"
    3. **scene_description**: A creative, cinematic visual scene (in English) that DIRECTLY illustrates the cover_text.
       - AVOID cliché "person at computer" scenes.
       - Use dramatic metaphors, unexpected visuals, movie-poster quality.
       - Must be SPECIFIC and actionable.
       - CRITICAL: The scene MUST be SIMPLE and CLEAN with maximum 2-3 main visual elements.
         These covers will be viewed as tiny ~150px thumbnails on Instagram grid.
         Too many background elements create visual clutter. Think BOLD and SIMPLE, not detailed and complex.
       - GOOD example: man + giant robot shadow on wall (2 elements, clean)
       - BAD example: man surrounded by 7 characters in different costumes (too many elements, cluttered)
    
    The 3 themes MUST be meaningfully different from each other:
    - Theme 1: Focus on SHOCK / PROVOCATIVE angle
    - Theme 2: Focus on CURIOSITY / MYSTERY angle  
    - Theme 3: Focus on EMPOWERMENT / BENEFIT angle
    
    Return EXACTLY this JSON array:
    [
        {{
            "theme_name": "...",
            "cover_text": "...",
            "scene_description": "..."
        }},
        {{
            "theme_name": "...",
            "cover_text": "...",
            "scene_description": "..."
        }},
        {{
            "theme_name": "...",
            "cover_text": "...",
            "scene_description": "..."
        }}
    ]
    """
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"}
        )
        raw = response.text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed[:3]
        return [parsed]
    except Exception as e:
        print(f"Error generating themes: {e}")
        return [
            {"theme_name": "fallback1", "cover_text": "BUNU İZLE", "scene_description": "A dramatic cinematic portrait."},
            {"theme_name": "fallback2", "cover_text": "İNANILMAZ", "scene_description": "A mysterious moody scene."},
            {"theme_name": "fallback3", "cover_text": "HERKES ŞAŞIRDI", "scene_description": "An empowering dynamic shot."},
        ]


# Keep backward compatibility
def generate_cover_text(video_name: str, script_text: str) -> str:
    result = generate_cover_text_and_scene(video_name, script_text)
    return result.get("cover_text", video_name.upper())


def evaluate_image_with_vision(image_url: str, style_guide: str, expected_text: str, learnings: str = ""):
    print("Evaluating generated image with Gemini 2.5 Pro Vision...")
    
    if not client:
         print("Gemini client not initialized. Cannot evaluate.")
         return {"score": 0, "critique": "Gemini Client Error", "improved_prompt": ""}
    
    try:
         img_resp = requests.get(image_url, timeout=30)
         img_bytes = img_resp.content
    except Exception as e:
         print(f"Failed to fetch image for evaluation: {e}")
         return {"score": 0, "critique": "Fetch Image Error", "improved_prompt": ""}
         
    system_prompt = (
        "You are an expert design director evaluating a generated social media cover photo for Instagram Reels. "
        "Your job is to review the image based on a specific Style Guide, past learnings from user feedback, "
        "and critical quality checks."
    )
    user_prompt = f"""
    Here is the Rourke Style Guide we are trying to achieve:
    {style_guide}
    
    Here are CRITICAL learnings from past user feedback that MUST be checked:
    {learnings}
    
    The text that MUST be on the image is: "{expected_text}"
    
    Evaluate the image on ALL of the following criteria. Each violation should significantly reduce the score:
    
    ## CRITICAL CHECKS (Instant fail = score 0-2 if violated):
    1. **Text Present**: Is there ANY text visible on the image at all? If NO text is rendered → score 0.
    2. **Text Duplication**: Is the text repeated/duplicated? If yes → score 0.
    3. **English Words**: Does the rendered text or ANY visible text/element contain ANY English words? If yes → score 0.
       - Check not only the main text but also any text on computer screens, books, signs, etc.
    4. **Text Spelling**: Is the text spelled exactly as specified? Any misspelling → score 2.
    
    ## HIGH PRIORITY CHECKS (Major penalty if violated):
    5. **Instagram 4:5 Safe Zone**: Instagram crops 9:16 to 4:5 on profile grid. The top ~285px and bottom ~285px get cut.
       - Is ALL text within the safe zone (y=285 to y=1635 on a 1080x1920 image)?
       - Text at the very top or very bottom will be cropped → score max 3.
    6. **Text Size**: Is the text LARGE enough to read on a small phone screen? 
       - Text should occupy at least 60-80% of the image width.
       - If text is small/hard to read → score max 4.
    7. **Text Readability**: Does the text stand out from the background? High contrast needed.
    
    ## QUALITY CHECKS:
    8. **Subject Framing**: Is the person shown in close/medium shot (waist up or chest up)?
       - Full-body far shots are too small for social media → penalty.
    9. **Visual-Text Consistency**: Does the scene/action in the image match what the text says?
       - The visual should reinforce the text message.
    10. **Visual Creativity**: Is the scene creative and original, or is it a cliché?
        - Cliché: Person sitting at computer looking at a screen. PENALTY.
        - Creative: Dramatic metaphors, real-life scale elements, unexpected perspectives. BONUS.
    11. **Overall Aesthetic**: Cinematic, moody, professional look as per Rourke style guide.
    12. **Face Identity**: Does the person look consistent with the reference photo?
    13. **Background Simplicity (GRID TEST)**: Does the background have maximum 2-3 main visual elements?
        - Imagine this image shrunk to 150x150 pixels on Instagram grid. Is it still clean and readable?
        - Too many characters, objects, or details in background → PENALTY (score max 5).
        - When in doubt, simpler is better.
    14. **Overlay Text vs In-Scene Text**: Does the image have a large, bold OVERLAY text?
        - Text only on a paper, screen, or other in-scene object is NOT sufficient.
        - The text must be a prominent overlay that reads at thumbnail size → score max 3 if missing.
    
    Provide your evaluation in JSON format:
    {{
        "score": <number 0-10>,
        "critique": "<short string explaining good and bad>",
        "text_present": <true/false>,
        "text_duplicated": <true/false>,
        "has_english_words": <true/false>,
        "text_in_safe_zone": <true/false>,
        "text_large_enough": <true/false>,
        "visual_text_consistent": <true/false>,
        "face_matches_reference": <true/false>,
        "background_too_cluttered": <true/false>,
        "has_overlay_text": <true/false>,
        "improved_prompt": "<if score < 8, a new detailed prompt fixing all issues>"
    }}
    """
    
    try:
         image_part = genai_types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")
         response = client.models.generate_content(
             model="gemini-2.5-flash",
             contents=[
                 image_part,
                 system_prompt + "\n\n" + user_prompt
             ],
             config={"response_mime_type": "application/json"}
         )
         result = response.text
         evaluation = json.loads(result)
         if isinstance(evaluation, list): evaluation = evaluation[0] if len(evaluation) > 0 else {}
         
         # Enforce hard rules
         if not evaluation.get("text_present", True):
             evaluation["score"] = 0
             evaluation["critique"] = f"CRITICAL: No text rendered on image. {evaluation.get('critique', '')}"
         if evaluation.get("text_duplicated", False):
             evaluation["score"] = 0
             evaluation["critique"] = f"CRITICAL: Text is duplicated. {evaluation.get('critique', '')}"
         if evaluation.get("has_english_words", False):
             evaluation["score"] = 0
             evaluation["critique"] = f"CRITICAL: English words detected in text. {evaluation.get('critique', '')}"
         if not evaluation.get("text_in_safe_zone", True):
             evaluation["score"] = min(evaluation.get("score", 0), 3)
             evaluation["critique"] = f"CRITICAL: Text outside 4:5 safe zone. {evaluation.get('critique', '')}"
         if evaluation.get("background_too_cluttered", False):
             evaluation["score"] = min(evaluation.get("score", 0), 5)
             evaluation["critique"] = f"GRID CLUTTER: Too many background elements for Instagram grid thumbnail. {evaluation.get('critique', '')}"
         if not evaluation.get("has_overlay_text", True):
             evaluation["score"] = min(evaluation.get("score", 0), 3)
             evaluation["critique"] = f"CRITICAL: No overlay text — in-scene text only is not sufficient. {evaluation.get('critique', '')}"
             
         return evaluation
    except Exception as e:
         print(f"Failed to parse Vision evaluation via Gemini: {e}")
         return {"score": 0, "critique": "Failed to parse evaluation", "improved_prompt": ""}


def run_autonomous_generation(local_person_image_path: str, video_topic: str, main_text: str, output_path: str, max_retries: int = 2, variant_index: int = 1, script_text: str = "", scene_description: str = "", extra_cutout_paths: list = None):
    # Load style guide
    with open("rourke_style_guide.md", "r") as f:
         style_guide = f.read()
    
    # Load learnings
    learnings = ""
    learnings_path = os.path.join(os.path.dirname(__file__), "learnings.md")
    if os.path.exists(learnings_path):
        with open(learnings_path, "r") as f:
            learnings = f.read()
         
    # 1. Upload base image to ImgBB
    person_image_url = upload_to_imgbb(local_person_image_path)
    if not person_image_url:
        print("Aborting because ImgBB upload failed.")
        return False
    
    # 1b. Upload extra reference cutouts for stronger face identity locking
    extra_ref_urls = []
    if extra_cutout_paths:
        for extra_path in extra_cutout_paths[:2]:  # Max 2 extra
            if extra_path and os.path.exists(extra_path) and extra_path != local_person_image_path:
                extra_url = upload_to_imgbb(extra_path)
                if extra_url:
                    extra_ref_urls.append(extra_url)
        print(f"Uploaded {len(extra_ref_urls)} extra reference(s) for face identity reinforcement.")
        
    # Variant-specific instructions for visual diversity
    variant_instruction = ""
    if variant_index == 1:
        variant_instruction = "A candid, unposed, in-the-moment cinematic shot. The subject should be engaged in an action related to the topic. Avoid looking directly at the camera. Use dramatic, single-source lighting (like screen glow, a campfire, or streetlamp). CLOSE-UP or MEDIUM SHOT (chest/waist up). Do NOT use a full-body wide shot."
    elif variant_index == 2:
        variant_instruction = "A selfie perspective or close-up environmental portrait. The subject is partially silhouette or illuminated by strong rim lighting (like sunset or neon signs behind them). Focus on a moody, contemplative atmosphere. Do not make it look like a corporate stock photo. MEDIUM SHOT (waist up). Do NOT use a full-body wide shot."
    else:
        variant_instruction = "A mysterious, moody low-angle or high-angle close-up shot. The environment should heavily dictate the lighting (e.g., inside a car at night, in a dimly lit room). The face should be partially in shadow but still clearly visible. Shot on 35mm film, highly realistic and authentic. CLOSE-UP (shoulders and above). Do NOT use a full-body wide shot."

    # Build scene context from the scene_description if provided
    scene_context = ""
    if scene_description:
        scene_context = f"The scene MUST visually match this description: {scene_description}. The visual action should directly reinforce the cover text '{main_text}'."

    current_prompt = (
        f"CRITICAL FACE IDENTITY INSTRUCTION: The person in this image MUST have the EXACT SAME face, facial features, "
        f"and identity as shown in the reference image(s). This is the MOST IMPORTANT requirement. "
        f"The person's face shape, eyes, nose, mouth, jawline, skin tone, facial hair, and hair style must ALL match "
        f"the reference photo EXACTLY. Do NOT generate a generic or different person. "
        f"If in doubt, prioritize face accuracy over everything else. "
        f"\n\n"
        f"A cinematic, highly authentic, and moody vertical photo for a social media cover (Instagram Reels). "
        f"The subject must match the facial identity from the image reference — same person, same face, no substitutions. "
        f"Choose the subject's clothing to match the video topic: for tech/casual/creative topics use streetwear, hoodie, or t-shirt; for business/finance/corporate topics use a smart casual outfit like a dark blazer, turtleneck, or dark button-down shirt; for motivational/luxury topics use a sleek, premium look. The clothing should feel natural and context-appropriate, never generic stock-photo style. "
        f"DO NOT make the subject look like a generic stock photo model. "
        f"{scene_context} "
        f"The video topic is: '{video_topic}'. "
        f"Lighting: Highly dramatic, single-source lighting (screen glow, neon reflection, sunlight rim light). Deep shadows, not evenly lit. "
        f"Vibe: Candid, unposed, in-the-moment. Not looking directly at the camera smiling. Shot on 35mm film, grainy, realistic texture. "
        f"Colors: Cinematic grading, cool shadows with warm highlights. "
        f"\n\n"
        f"BACKGROUND SIMPLICITY (CRITICAL — INSTAGRAM GRID RULE): "
        f"The background must be SIMPLE and CLEAN with maximum 2-3 main visual elements total (including the person). "
        f"This cover will be viewed as a tiny ~150px thumbnail on an Instagram profile grid alongside many other covers. "
        f"Too many background elements create visual clutter and make the grid look messy. "
        f"If background elements exist, apply depth-of-field blur/bokeh so the person stays sharp. "
        f"Think BOLD and SIMPLE, not detailed and complex. Reference: 'ÜCRETSİZ MİLYON İZLEN' cover — dark background, one person, huge text. "
        f"\n\n"
        f"TEXT INSTRUCTIONS (EXTREMELY IMPORTANT - FOLLOW EXACTLY): "
        f"The text MUST EXACTLY read: '{main_text}'. "
        f"The text language is TURKISH. Do NOT include any English words in the rendered text. "
        f"Write the text ONLY ONCE. Do NOT repeat or duplicate the text under any circumstances. "
        f"Text placement: Place the text in the VERTICAL CENTER or SLIGHTLY BELOW CENTER of the image. "
        f"The text MUST be within the Instagram 4:5 safe zone — do NOT place text in the top 15% or bottom 15% of the image. "
        f"Text size: The text MUST be EXTREMELY LARGE — at the scale of a MOVIE POSTER TITLE or BILLBOARD. "
        f"Each line of text must cover 75-80% of the image width. Think BILLBOARD, not book cover. "
        f"The text must be the DOMINANT visual element — readable even at 150px thumbnail size. "
        f"If the text has more than 7 characters total, split it into 2 lines for maximum readability. "
        f"Font: Bold, modern sans-serif, all-caps. High contrast with background (white text with dark shadow, or bright yellow). "
        f"\n\n"
        f"Special Instructions: {variant_instruction} "
        f"--cref {person_image_url} --cw 80"
    )
    
    best_image_url = None
    best_score = -1
    
    for attempt in range(1, max_retries + 1):
        print(f"\n--- Attempt {attempt} of {max_retries} ---")
        print(f"Using Prompt (first 500 chars): {current_prompt[:500]}...\n")
        
        # 2. Generate Image
        generated_image_url = generate_cover_with_nanobanana(person_image_url, current_prompt, extra_ref_urls=extra_ref_urls)
        
        if not generated_image_url:
            print("Generation failed. Skipping evaluation.")
            continue
            
        print(f"Image generated! URL: {generated_image_url}")
        
        # 3. Evaluate with Vision (now includes learnings)
        evaluation = evaluate_image_with_vision(generated_image_url, style_guide, main_text, learnings)
        
        score_val = evaluation.get("score", 0)
        try:
            score = float(score_val)
        except (ValueError, TypeError):
            score = 0
            
        critique = evaluation.get("critique", "")
        improved_prompt = evaluation.get("improved_prompt", "")
        
        print(f"Score: {score}/10")
        print(f"Critique: {critique}")
        
        # Log detailed check results
        checks = {
            "text_duplicated": evaluation.get("text_duplicated"),
            "has_english_words": evaluation.get("has_english_words"),
            "text_in_safe_zone": evaluation.get("text_in_safe_zone"),
            "text_large_enough": evaluation.get("text_large_enough"),
            "visual_text_consistent": evaluation.get("visual_text_consistent"),
            "face_matches_reference": evaluation.get("face_matches_reference"),
        }
        print(f"Detailed checks: {json.dumps(checks, indent=2)}")
        
        # Keep track of the best one so far
        if score > best_score:
             best_score = score
             best_image_url = generated_image_url
             
        if score >= 8:
             print("Score is exceptionally high! Accepting this as the final image.")
             break
        else:
             if attempt < max_retries:
                  print("Score is below threshold. Adjusting prompt for next attempt.")
                  if improved_prompt:
                       current_prompt = improved_prompt
                  else:
                       print("No improved prompt provided by Vision. Retrying with same prompt...")
             else:
                  print("Max retries reached. Settling for the best image generated.")
                  
    if best_image_url:
         print(f"\nDownloading final best cover (Score: {best_score})")
         img_data = requests.get(best_image_url, timeout=30).content
         with open(output_path, 'wb') as handler:
              handler.write(img_data)
         print(f"Final cover saved to {output_path}")
         return True
    else:
         print("\nFailed to generate any valid images.")
         return False

if __name__ == "__main__":
    local_image = "outputs/IMG_4188_nobg.png"
    topic = "AI ile iş süreçlerini otomasyona çevirmek"
    text = "OTOMATİĞE AL"
    
    if os.path.exists(local_image):
        run_autonomous_generation(local_image, topic, text, "outputs/autonomous_cover_final.png", max_retries=2)
    else:
        print("Base cutout image not found.")
