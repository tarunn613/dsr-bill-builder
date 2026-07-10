import pdfplumber

def find_rotated_or_wide_content(path):
    """Find pages with rotation or different table structures."""
    print(f"Scanning {path}...")
    
    with pdfplumber.open(path) as pdf:
        for i in range(len(pdf.pages)):
            page = pdf.pages[i]
            text = page.extract_text()
            if not text:
                continue
            
            # Check for Devanagari - skip Hindi
            devanagari_count = sum(1 for char in text if '\u0900' <= char <= '\u097F')
            if devanagari_count > 20:
                continue
            
            # Check page rotation attribute
            rotation = getattr(page, 'rotation', 0) or 0
            if rotation != 0:
                print(f"\nPAGE {i} - ROTATION: {rotation}")
                print(text[:400])
                print("---")
                continue
            
            # Look for tables with different column headers (not the standard Code/Description/Unit/Rate)
            # Also check for "Analysis" tables or tables with labour/material breakdown
            lower_text = text.lower()
            if any(keyword in lower_text for keyword in ['labour', 'material', 'analysis of rates', 'lead', 'sundries']):
                # Check if this looks like a different table format
                lines = text.split('\n')
                if len(lines) > 2:
                    first_lines = ' '.join(lines[:5])
                    if 'Code' not in first_lines and 'Description' not in first_lines:
                        # Might be a different format page
                        pass
            
            # Look for lines that are unusually long (may indicate wide/landscape content)
            lines = text.split('\n')
            max_line_len = max(len(l) for l in lines) if lines else 0
            if max_line_len > 150:
                print(f"\nPAGE {i} - Very long lines (max {max_line_len} chars)")
                print(text[:500])
                print("---")

find_rotated_or_wide_content("./data/booklets/voll_1.pdf")
print("\n" + "="*80 + "\n")
find_rotated_or_wide_content("./data/booklets/voll_2.pdf")
