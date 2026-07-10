import fitz  # PyMuPDF

def check_pdf(path):
    print(f"Checking {path} with PyMuPDF for images")
    try:
        doc = fitz.open(path)
        page = doc[100]
        image_list = page.get_images()
        if image_list:
            print(f"Page 100 contains {len(image_list)} images.")
            for img in image_list:
                print(f"Image details: {img}")
        else:
            print("No images found on page 100.")
            
        print("Text on page 100:")
        print(page.get_text()[:100])
    except Exception as e:
        print(f"Error reading {path}: {e}")

check_pdf("./data/booklets/voll_1.pdf")
