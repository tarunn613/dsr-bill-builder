import pdfplumber

def test_extraction(pdf_path):
    print(f"Testing {pdf_path}")
    with pdfplumber.open(pdf_path) as pdf:
        # Scan first 30 pages
        for i in range(30):
            if i >= len(pdf.pages): break
            page = pdf.pages[i]
            text = page.extract_text()
            if text and "Code" in text and "Description" in text:
                print(f"--- Found Table Header on Page {i} ---")
                print(text[:300] + "...\n")
                
                print("Trying table extraction...")
                tables = page.extract_tables()
                if tables:
                    print(f"Extracted {len(tables)} tables.")
                    for row in tables[0][:3]:
                        print(row)
                else:
                    print("No structured tables found using default settings.")
                print("-" * 40)
                break

test_extraction("./data/booklets/voll_1.pdf")
test_extraction("./data/booklets/voll_2.pdf")
