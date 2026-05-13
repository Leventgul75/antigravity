import os

# Set environment variables BEFORE importing main/config
os.environ["ENV"] = "production"
os.environ["DRY_RUN"] = "0"
os.environ["NOTION_SOCIAL_TOKEN"] = "dummy_token"
os.environ["NOTION_LINKEDIN_DB_ID"] = "dummy_db_id"

import logging
from main import run_diageo_turkey, setup_logging

if __name__ == "__main__":
    setup_logging()
    logging.info("!!! FORCE RUN BAŞLATILIYOR !!!")
    logging.info("Bu işlem LinkedIn'de GERÇEK bir paylaşım yapacaktır.")
    
    run_diageo_turkey()
    logging.info("!!! FORCE RUN TAMAMLANDI !!!")
