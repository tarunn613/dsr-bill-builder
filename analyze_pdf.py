import fitz  # PyMuPDF

def analyze_pdf(path):
    print(f"Analyzing {path}")
    try:
        doc = fitz.open(path)
        print(f"Total pages: {len(doc)}")
        
        # Check a few pages
        for i in [5, 50, 100, 200, min(300, len(doc)-1)]:
            if i < len(doc):
                page = doc[i]
                text = page.get_text()
                images = page.get_images()
                drawings = page.get_drawings()
                print(f"Page {i}: Text length: {len(text)}, Images: {len(images)}, Drawings: {len(drawings)}")
                
    except Exception as e:
        print(f"Error reading {path}: {e}")

analyze_pdf("./data/booklets/voll_1.pdf")
