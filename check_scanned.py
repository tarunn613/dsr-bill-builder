import pdfplumber

def check_pdf(path):
    print(f"Checking {path}")
    with pdfplumber.open(path) as pdf:
        # Check specific middle pages
        pages_to_check = [100, 150, 200, 250, 300]
        for i in pages_to_check:
            if i < len(pdf.pages):
                text = pdf.pages[i].extract_text()
                if text and len(text.strip()) > 50:
                    print(f"Found substantial text on page {i}:")
                    print(text[:200] + "...\n")
                else:
                    print(f"Page {i} has no substantial text.")

check_pdf("./data/booklets/voll_1.pdf")
print("-" * 40)
check_pdf("./data/booklets/voll_2.pdf")
