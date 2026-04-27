import os
import sys
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), "..", "..", "_knowledge", "credentials", "master.env")
if os.path.exists(env_path):
    load_dotenv(env_path)

# Antigravity V2 Fail-Fast Environment Validation
class Config:
    def __init__(self):
        # 1. Environment mode
        self.ENV = os.environ.get("ENV", "development").lower()
        self.IS_DRY_RUN = self.ENV == "development" or os.environ.get("DRY_RUN", "0") == "1"

        # Perplexity — AI haberleri araştırması
        self.PERPLEXITY_API_KEY = self._require_env("PERPLEXITY_API_KEY")
        self.PERPLEXITY_BASE_URL = os.environ.get("PERPLEXITY_BASE_URL", "https://api.perplexity.ai")

        # OpenAI — Post yazma (GPT-4.1) + Görsel prompt (GPT-4.1-mini)
        self.OPENAI_API_KEY = self._require_env("OPENAI_API_KEY")

        # Gemini — Görsel üretme (gemini-2.0-flash-exp veya gemini-2.0-flash-preview-image-generation)
        self.GEMINI_API_KEY = self._require_env("GEMINI_API_KEY")

        # LinkedIn API
        self.LINKEDIN_ACCESS_TOKEN = self._require_env("LINKEDIN_ACCESS_TOKEN")
        self.LINKEDIN_PERSON_URN = self._require_env("LINKEDIN_PERSON_URN")

    def _require_env(self, key, default=None):
        """Fetches an environment variable, raises error if missing."""
        val = os.environ.get(key, default)
        if not val:
            raise EnvironmentError(f"CRITICAL STARTUP FAILURE: Gerekli ortam değişkeni {key} bulunamadı!")
        return val

# Instantiating the config globally so it fails fast on module load.
try:
    settings = Config()
except EnvironmentError as e:
    print(f"BOOT ERROR: {e}")
    sys.exit(1)
