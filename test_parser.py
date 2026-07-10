import pdfplumber
import re

def is_hindi(text):
    # Check if text contains a significant amount of Devanagari characters
    devanagari_count = sum(1 for char in text if '\u0900' <= char <= '\u097F')
    return devanagari_count > 20

def parse_pdf(path, max_pages=30):
    items = []
    
    # Regex to match the start of an item (e.g., "0583", "13.1", "13.1.1")
    code_pattern = re.compile(r'^(\d{4,5}|\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(.*)')
    
    # Regex to match the end of an item (Unit and Rate). Rate is usually ending with .00 or similar.
    # We assume the last token is the rate, and the 1 or 2 tokens before it are the unit.
    end_pattern = re.compile(r'(?:\s+|^)((?:\d+\s+)?[a-zA-Z]+)\s+([\d,]+\.\d{2})$')

    with pdfplumber.open(path) as pdf:
        for i in range(min(max_pages, len(pdf.pages))):
            page = pdf.pages[i]
            text = page.extract_text()
            
            if not text:
                continue
                
            if is_hindi(text):
                print(f"Skipping page {i} (Hindi detected)")
                continue
                
            lines = text.split('\n')
            
            current_code = None
            current_desc = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                    
                match_start = code_pattern.match(line)
                if match_start:
                    # If we had a previous item that didn't finish cleanly, just save what we have
                    if current_code:
                        items.append({'code': current_code, 'desc': " ".join(current_desc), 'unit': 'UNKNOWN', 'rate': 'UNKNOWN'})
                        
                    current_code = match_start.group(1)
                    rest_of_line = match_start.group(2)
                    
                    match_end = end_pattern.search(rest_of_line)
                    if match_end:
                        unit = match_end.group(1).strip()
                        rate = match_end.group(2).strip()
                        desc = rest_of_line[:match_end.start()].strip()
                        items.append({'code': current_code, 'desc': desc, 'unit': unit, 'rate': rate})
                        current_code = None
                        current_desc = []
                    else:
                        current_desc.append(rest_of_line)
                elif current_code:
                    # We are inside a multi-line item
                    match_end = end_pattern.search(line)
                    if match_end:
                        unit = match_end.group(1).strip()
                        rate = match_end.group(2).strip()
                        desc_part = line[:match_end.start()].strip()
                        if desc_part:
                            current_desc.append(desc_part)
                            
                        full_desc = " ".join(current_desc)
                        items.append({'code': current_code, 'desc': full_desc, 'unit': unit, 'rate': rate})
                        current_code = None
                        current_desc = []
                    else:
                        current_desc.append(line)
                        
            # Save any trailing item
            if current_code:
                items.append({'code': current_code, 'desc': " ".join(current_desc), 'unit': 'UNKNOWN', 'rate': 'UNKNOWN'})

    print(f"\nFound {len(items)} items in first {max_pages} pages.")
    for item in items[:15]:
        print(item)

parse_pdf("./data/booklets/voll_2.pdf", max_pages=30)
