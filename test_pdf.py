import pdfplumber

with pdfplumber.open("./data/booklets/voll_1.pdf") as pdf:
    # Print text from a few pages in the middle to skip index/preface
    print("--- Page 50 ---")
    page = pdf.pages[50]
    print(page.extract_text())
    
    print("\n--- Page 50 tables ---")
    tables = page.extract_tables()
    for t in tables:
        for row in t:
            print(row)
