import fs from 'fs';
import path from 'path';

async function fetchHuggingFaceSample(dataset, config, split, count) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${split}&offset=0&length=${count}`;
  console.log(`Fetching from: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch ${dataset}: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.rows;
  } catch (error) {
    console.error(`Error fetching ${dataset}:`, error);
    return null;
  }
}

async function downloadRecommendedDatasets() {
  const outputDir = path.join(process.cwd(), 'data_seeds');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Download Europarl (English-French example)
  console.log('--- Downloading Europarl (EN-FR) Sample ---');
  const europarlRows = await fetchHuggingFaceSample('Helsinki-NLP/europarl', 'en-fr', 'train', 500);
  if (europarlRows) {
    const europarlData = europarlRows.map(row => ({
      source: row.row.translation.en,
      target: row.row.translation.fr,
      sourceLang: 'en',
      targetLang: 'fr',
      domain: 'legal/formal'
    }));
    
    const europarlPath = path.join(outputDir, 'europarl_en_fr_seed.json');
    fs.writeFileSync(europarlPath, JSON.stringify(europarlData, null, 2));
    console.log(`✅ Saved ${europarlData.length} Europarl translation pairs to ${europarlPath}`);
  }

  // 2. Download Samanantar (English-Hindi example)
  // Note: Since Samanantar is huge and sometimes specific splits vary, we'll try to fetch a reliable Indic dataset
  // AI4Bharat's samanantar is widely used. We'll fetch from an available HuggingFace source.
  console.log('\n--- Downloading Samanantar/Indic (EN-HI) Sample ---');
  const indicRows = await fetchHuggingFaceSample('cfilt/iitb-english-hindi', 'default', 'train', 500);
  if (indicRows) {
    const indicData = indicRows.map(row => ({
      source: row.row.translation.en,
      target: row.row.translation.hi,
      sourceLang: 'en',
      targetLang: 'hi_IN',
      domain: 'general'
    }));
    
    const indicPath = path.join(outputDir, 'samanantar_iitb_en_hi_seed.json');
    fs.writeFileSync(indicPath, JSON.stringify(indicData, null, 2));
    console.log(`✅ Saved ${indicData.length} Indic (Samanantar proxy) translation pairs to ${indicPath}`);
  }

  console.log('\nDownloads complete! You can now seed these into your SQLite TM database.');
}

downloadRecommendedDatasets();
