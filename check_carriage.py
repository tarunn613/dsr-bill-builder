import fitz  # PyMuPDF
import re
import json

DISTANCE_KEYS = ["1km", "2km", "3km", "4km", "5km", 
                 "beyond_5km_upto_10km_per_km", 
                 "beyond_10km_upto_20km_per_km", 
                 "beyond_20km_addl_per_km"]

path = "./data/booklets/voll_1.pdf"

code_pattern = re.compile(r'^\d{1,2}\.\d{1,2}(?:\.\d{1,3})*$')
rate_pattern = re.compile(r'^[\d,]+\.\d{2}$')

def parse_carriage_block(lines):
    """Parse a single item block from a carriage page.
    
    Expected structure:
    - Line 0: Code (e.g., '1.1.17.1')
    - Line 1: Description (e.g., '100 mm dia')
    - Line 2: Unit (e.g., '100 m')
    - Lines 3+: Rate values for each distance column (1km through beyond_20km)
    """
    if not lines:
        return None
    
    code = lines[0].strip()
    if not code_pattern.match(code):
        return None
    
    # Find where rates start (first line that looks like a number)
    desc_parts = []
    unit = ''
    rates = []
    
    for i in range(1, len(lines)):
        text = lines[i].strip()
        if rate_pattern.match(text):
            rates.append(text)
        else:
            # Could be description or unit
            # Units typically look like "100 m", "cum", "tonne", "1000 Nos", "qtl"
            if re.match(r'^\d*\s*(m|cum|tonne|Nos|qtl|each|kg|litre|sq\.?m|sqm)$', text):
                unit = text
            else:
                desc_parts.append(text)
    
    description = ' '.join(desc_parts)
    
    # Build rate JSON
    rate_json = {}
    for ki, key in enumerate(DISTANCE_KEYS):
        if ki < len(rates):
            rate_json[key] = rates[ki]
    
    return {
        'code': code,
        'description': description,
        'unit': unit,
        'rate': json.dumps(rate_json) if rate_json else ''
    }


def find_and_parse_carriage_pages(pdf_path):
    """Find all carriage pages and parse them using PyMuPDF dict mode."""
    doc = fitz.open(pdf_path)
    items = []
    carriage_page_indices = []
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        data = page.get_text("dict")
        
        # Check if this is a carriage page by looking for rotated text blocks
        has_rotated_blocks = False
        rotated_blocks = []
        
        for block in data['blocks']:
            if block.get('type') != 0:
                continue
            for line in block.get('lines', []):
                direction = line.get('dir', (1, 0))
                # Rotated text has direction (0, -1) or (0, 1)
                if abs(direction[0]) < 0.1 and abs(direction[1]) > 0.9:
                    has_rotated_blocks = True
                    break
            if has_rotated_blocks:
                break
        
        if not has_rotated_blocks:
            continue
        
        # This is a rotated page - check if it has rate data
        # Extract all blocks with rotated text
        for block in data['blocks']:
            if block.get('type') != 0:
                continue
            
            block_lines = []
            is_rotated = False
            for line in block.get('lines', []):
                direction = line.get('dir', (1, 0))
                if abs(direction[0]) < 0.1:
                    is_rotated = True
                text_parts = [span['text'] for span in line.get('spans', [])]
                block_lines.append(''.join(text_parts).strip())
            
            if not is_rotated or not block_lines:
                continue
            
            # Check if first line is a code
            first_line = block_lines[0]
            if code_pattern.match(first_line):
                item = parse_carriage_block(block_lines)
                if item and item['rate']:
                    items.append(item)
                    if page_idx not in carriage_page_indices:
                        carriage_page_indices.append(page_idx)
    
    doc.close()
    return items, carriage_page_indices


print("Parsing carriage pages from Vol 1...")
items, pages = find_and_parse_carriage_pages(path)

print(f"\nFound {len(items)} carriage items across pages: {pages}")

# Verify against screenshot (page 173 = booklet page 82)
print("\n--- Items from page 173 (booklet page 82) ---")
for item in items:
    rates = json.loads(item['rate']) if item['rate'] else {}
    print(f"\n  Code: {item['code']}")
    print(f"  Desc: {item['description']}")
    print(f"  Unit: {item['unit']}")
    print(f"  Rates: {json.dumps(rates)}")

# Cross-check 1.1.17.1 against the screenshot
print("\n\n=== Cross-check against screenshot ===")
for item in items:
    if item['code'] == '1.1.17.1':
        rates = json.loads(item['rate'])
        print(f"Code: {item['code']}")
        print(f"Description: {item['description']}")
        print(f"Unit: {item['unit']}")
        print(f"1km rate: {rates.get('1km', 'MISSING')} (expected: 380.42)")
        print(f"2km rate: {rates.get('2km', 'MISSING')} (expected: 429.85)")
        print(f"3km rate: {rates.get('3km', 'MISSING')} (expected: 478.76)")
        print(f"4km rate: {rates.get('4km', 'MISSING')} (expected: 525.70)")
        print(f"5km rate: {rates.get('5km', 'MISSING')} (expected: 571.25)")
        break
