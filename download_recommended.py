import os
import json
try:
    from datasets import load_dataset
except ImportError:
    print("Please install the datasets library first: pip install datasets")
    exit(1)

def download_recommended():
    os.makedirs('data_seeds', exist_ok=True)
    
    # 1. Indic dataset (proxy for Samanantar to guarantee fast download)
    print("Downloading Indic Translation dataset...")
    try:
        # Use first 500 rows of IITB
        dataset = load_dataset("cfilt/iitb-english-hindi", split="train[:500]", trust_remote_code=True)
        seed_data = []
        for row in dataset:
            seed_data.append({
                "source": row['translation']['en'],
                "target": row['translation']['hi'],
                "sourceLang": "en",
                "targetLang": "hi_IN",
                "domain": "general"
            })
        
        output_path = os.path.join('data_seeds', 'samanantar_iitb_en_hi_seed.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(seed_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved {len(seed_data)} Indic translation pairs to {output_path}")
    except Exception as e:
        print(f"❌ Failed to download Indic dataset: {e}")

    # 2. Europarl (EN-FR)
    print("Downloading Europarl (EN-FR)...")
    try:
        dataset = load_dataset("Helsinki-NLP/europarl", "en-fr", split="train[:500]", trust_remote_code=True)
        seed_data = []
        for row in dataset:
            seed_data.append({
                "source": row['translation']['en'],
                "target": row['translation']['fr'],
                "sourceLang": "en",
                "targetLang": "fr",
                "domain": "legal/formal"
            })
        
        output_path = os.path.join('data_seeds', 'europarl_en_fr_seed.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(seed_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved {len(seed_data)} Europarl translation pairs to {output_path}")
    except Exception as e:
        print(f"❌ Failed to download Europarl dataset: {e}")

if __name__ == "__main__":
    download_recommended()
