import pdfplumber
import re

def is_hindi(text):
    devanagari_count = sum(1 for char in text if '\u0900' <= char <= '\u097F')
    return devanagari_count > 20

def analyze_structure(path, start_page=0, max_pages=30):
    """Analyze the structure of the PDF to understand parent-child patterns."""
    
    # Updated regex to support deeper nesting: 13.73, 13.73.1, 4.20.1.3, 23.1.1.1
    code_pattern = re.compile(r'^(\d{1,2}(?:\.\d{1,3})+)\s+(.*)')
    basic_code_pattern = re.compile(r'^(\d{4,5})\s+(.*)')
    rate_pattern = re.compile(r'\s+((?:\d+\s+)?[a-zA-Z]+)\s+([\d,]+\.\d{2})$')
    
    with pdfplumber.open(path) as pdf:
        for i in range(start_page, min(start_page + max_pages, len(pdf.pages))):
            page = pdf.pages[i]
            text = page.extract_text()
            if not text or is_hindi(text):
                continue
            
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                match = code_pattern.match(line)
                if match:
                    code = match.group(1)
                    rest = match.group(2)
                    has_rate = bool(rate_pattern.search(rest))
                    
                    # Check depth
                    depth = code.count('.')
                    
                    if not has_rate:
                        print(f"[PARENT - no rate] depth={depth} code={code}")
                        print(f"  Text: {rest[:120]}...")
                    else:
                        rate_match = rate_pattern.search(rest)
                        desc = rest[:rate_match.start()].strip()
                        print(f"[LEAF   - has rate] depth={depth} code={code}")
                        print(f"  Desc: {desc[:80]}")
                        print(f"  Unit: {rate_match.group(1)}, Rate: {rate_match.group(2)}")
                    print()

print("=== VOLUME 2 (Sub-heads with hierarchical codes) ===")
# Pages around section 13.73
analyze_structure(
    "./data/booklets/voll_2.pdf",
    start_page=11, max_pages=15
)
