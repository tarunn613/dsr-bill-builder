import pdfplumber
import re

def is_hindi(text):
    devanagari_count = sum(1 for char in text if '\u0900' <= char <= '\u097F')
    return devanagari_count > 20

code_pattern = re.compile(r'^(\d{1,2}(?:\.\d{1,3})+)\s+(.*)')
rate_pattern = re.compile(r'\s+((?:\d+\s+)?[a-zA-Z]+)\s+([\d,]+\.\d{2})$')

# Scan ALL pages for the deepest codes
deep_codes = []

for vol in ["voll_1.pdf", "voll_2.pdf"]:
    path = f"./data/booklets/{vol}"
    with pdfplumber.open(path) as pdf:
        for i in range(len(pdf.pages)):
            text = pdf.pages[i].extract_text()
            if not text or is_hindi(text):
                continue
            for line in text.split('\n'):
                match = code_pattern.match(line.strip())
                if match:
                    code = match.group(1)
                    depth = code.count('.')
                    if depth >= 3:
                        deep_codes.append((code, depth, vol, i))

print(f"Found {len(deep_codes)} codes with depth >= 3")
for code, depth, vol, page in deep_codes[:20]:
    print(f"  depth={depth} code={code} (page {page} of {vol})")
    
# Count by depth
from collections import Counter
depth_counts = Counter(d for _, d, _, _ in deep_codes)
print(f"\nDepth distribution: {dict(depth_counts)}")
