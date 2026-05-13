import sys
import os
import importlib

sys.path.insert(0, '.')
files = [
    'main', 'config', 'logger', 
    'core.image_generator', 'core.linkedin_publisher', 
    'core.notion_logger', 'core.post_writer', 'core.researcher'
]

errors = []
for mod in files:
    try:
        importlib.import_module(mod)
        print(f"OK: {mod} imported successfully")
    except Exception as e:
        errors.append(f"{mod}: {type(e).__name__}: {e}")

if errors:
    print("\nIMPORT ERRORS:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("\nAll modules imported successfully")
