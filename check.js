import Database from 'better-sqlite3';

const db = new Database('clearlingo.db');

// Simulate a TM lookup — exactly what your app will do
const query = "Click the button to submit the form.";
const targetLang = "hi_IN";

const hit = db.prepare(`
  SELECT source_text, target_text, target_lang, context 
  FROM tm_records 
  WHERE source_text = ? AND target_lang = ?
`).get(query, targetLang);

if (hit) {
  console.log('✅ TM HIT! Found exact match:');
  console.log(hit);
} else {
  console.log('❌ No match found — would go to Gemini');
}

db.close();