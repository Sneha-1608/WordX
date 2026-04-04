import os
import json
try:
    from datasets import load_dataset
except ImportError:
    print("Please install the datasets library first: pip install datasets")
    exit(1)

def download_flores200_demo_data():
    """
    Downloads FLORES-200 English to Hindi translations to seed the ClearLingo TM
    and simulate human revision data for Layer 5 QLoRA training.
    """
    print("Downloading FLORES-200 (eng-hin) from Hugging Face...")
    
    try:
        # We use a clean mirrored version of FLORES-200 that works with the modern 'datasets' library
        # without triggering the "Custom Script Unsupported" error from facebook/flores.
        dataset = load_dataset("Muennighoff/flores200", "eng_Latn-hin_Deva")
        
        seed_data = []
        
        # Combine dev and devtest splits
        for split in ['dev', 'devtest']:
            if split in dataset:
                for row in dataset[split]:
                    seed_data.append({
                        "source": row['sentence_eng_Latn'],
                        "target": row['sentence_hin_Deva'],
                        "sourceLang": "en",
                        "targetLang": "hi_IN",
                        "domain": "benchmark"
                    })
                    
        # Save to a local JSON file that your Next.js app / SQLite seeder can easily read
        os.makedirs('data_seeds', exist_ok=True)
        output_path = os.path.join('data_seeds', 'flores_en_hi_seed.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(seed_data, f, ensure_ascii=False, indent=2)
            
        print(f"✅ Success! Saved {len(seed_data)} high-quality general-purpose translation pairs to {output_path}")
        print("You can use these to seed your SQlite 'tm_records' table for a flawless demonstration.")
    except Exception as e:
        print(f"❌ Failed to download FLORES-200: {e}")

if __name__ == "__main__":
    download_flores200_demo_data()
