// seed_tm_v2.js
// Run from project root:  node seed_tm_v2.js
// Adds technical/software TM entries matching your exact clearlingo.db schema
// Uses INSERT OR IGNORE so it never overwrites existing data

import Database from 'better-sqlite3';

const db = new Database('clearlingo.db');
db.pragma('journal_mode = WAL');

// ─── TM RECORDS (matches your exact columns) ──────────────────────────────────
const tmEntries = [

    // ── English → Hindi (hi_IN) — Technical/Software ──
    { source_text: "Click the button to submit the form.", target_text: "फ़ॉर्म सबमिट करने के लिए बटन पर क्लिक करें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Please enter your username and password.", target_text: "कृपया अपना उपयोगकर्ता नाम और पासवर्ड दर्ज करें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "An error occurred while processing your request.", target_text: "आपके अनुरोध को संसाधित करते समय एक त्रुटि हुई।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Your session has expired. Please log in again.", target_text: "आपका सत्र समाप्त हो गया है। कृपया फिर से लॉग इन करें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "The file was uploaded successfully.", target_text: "फ़ाइल सफलतापूर्वक अपलोड की गई।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Access denied. You do not have permission to view this page.", target_text: "पहुंच अस्वीकृत। आपके पास इस पृष्ठ को देखने की अनुमति नहीं है।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Save your changes before closing the window.", target_text: "विंडो बंद करने से पहले अपने परिवर्तन सहेजें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "The system is currently under maintenance.", target_text: "सिस्टम वर्तमान में रखरखाव के अधीन है।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Download the latest version of the software.", target_text: "सॉफ़्टवेयर का नवीनतम संस्करण डाउनलोड करें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Select the language from the dropdown menu.", target_text: "ड्रॉपडाउन मेनू से भाषा चुनें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "The document has been translated successfully.", target_text: "दस्तावेज़ का सफलतापूर्वक अनुवाद किया गया है।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Please wait while the document is being processed.", target_text: "कृपया प्रतीक्षा करें जब तक दस्तावेज़ संसाधित हो रहा है।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Invalid input. Please check your data and try again.", target_text: "अमान्य इनपुट। कृपया अपना डेटा जांचें और पुनः प्रयास करें।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "Your changes have been saved successfully.", target_text: "आपके परिवर्तन सफलतापूर्वक सहेजे गए हैं।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },
    { source_text: "The API request was successful.", target_text: "एपीआई अनुरोध सफल रहा।", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", context: "Technical" },

    // ── English → French (fr) ──
    { source_text: "Click the button to submit the form.", target_text: "Cliquez sur le bouton pour soumettre le formulaire.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "Please enter your username and password.", target_text: "Veuillez entrer votre nom d'utilisateur et votre mot de passe.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "An error occurred while processing your request.", target_text: "Une erreur s'est produite lors du traitement de votre demande.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "The file was uploaded successfully.", target_text: "Le fichier a été téléchargé avec succès.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "Save your changes before closing the window.", target_text: "Enregistrez vos modifications avant de fermer la fenêtre.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "The system is currently under maintenance.", target_text: "Le système est actuellement en maintenance.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "Download the latest version of the software.", target_text: "Téléchargez la dernière version du logiciel.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "The document has been translated successfully.", target_text: "Le document a été traduit avec succès.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "Your session has expired. Please log in again.", target_text: "Votre session a expiré. Veuillez vous reconnecter.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },
    { source_text: "Your changes have been saved successfully.", target_text: "Vos modifications ont été enregistrées avec succès.", source_lang: "en", target_lang: "fr", language: "fr", context: "Technical" },

    // ── English → Spanish (es) ──
    { source_text: "Click the button to submit the form.", target_text: "Haga clic en el botón para enviar el formulario.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "Please enter your username and password.", target_text: "Por favor, ingrese su nombre de usuario y contraseña.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "An error occurred while processing your request.", target_text: "Se produjo un error al procesar su solicitud.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "The file was uploaded successfully.", target_text: "El archivo se cargó correctamente.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "The system is currently under maintenance.", target_text: "El sistema está actualmente en mantenimiento.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "Download the latest version of the software.", target_text: "Descargue la última versión del software.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "The document has been translated successfully.", target_text: "El documento ha sido traducido exitosamente.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },
    { source_text: "Your changes have been saved successfully.", target_text: "Sus cambios han sido guardados exitosamente.", source_lang: "en", target_lang: "es", language: "es", context: "Technical" },

    // ── English → German (de) ──
    { source_text: "Click the button to submit the form.", target_text: "Klicken Sie auf die Schaltfläche, um das Formular abzusenden.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },
    { source_text: "Please enter your username and password.", target_text: "Bitte geben Sie Ihren Benutzernamen und Ihr Passwort ein.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },
    { source_text: "The file was uploaded successfully.", target_text: "Die Datei wurde erfolgreich hochgeladen.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },
    { source_text: "The system is currently under maintenance.", target_text: "Das System befindet sich derzeit in Wartung.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },
    { source_text: "Download the latest version of the software.", target_text: "Laden Sie die neueste Version der Software herunter.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },
    { source_text: "The document has been translated successfully.", target_text: "Das Dokument wurde erfolgreich übersetzt.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },
    { source_text: "Your changes have been saved successfully.", target_text: "Ihre Änderungen wurden erfolgreich gespeichert.", source_lang: "en", target_lang: "de", language: "de", context: "Technical" },

    // ── English → Japanese (ja) ──
    { source_text: "Click the button to submit the form.", target_text: "フォームを送信するには、ボタンをクリックしてください。", source_lang: "en", target_lang: "ja", language: "ja", context: "Technical" },
    { source_text: "Please enter your username and password.", target_text: "ユーザー名とパスワードを入力してください。", source_lang: "en", target_lang: "ja", language: "ja", context: "Technical" },
    { source_text: "The file was uploaded successfully.", target_text: "ファイルが正常にアップロードされました。", source_lang: "en", target_lang: "ja", language: "ja", context: "Technical" },
    { source_text: "The system is currently under maintenance.", target_text: "システムは現在メンテナンス中です。", source_lang: "en", target_lang: "ja", language: "ja", context: "Technical" },
    { source_text: "The document has been translated successfully.", target_text: "ドキュメントは正常に翻訳されました。", source_lang: "en", target_lang: "ja", language: "ja", context: "Technical" },
    { source_text: "Your changes have been saved successfully.", target_text: "変更が正常に保存されました。", source_lang: "en", target_lang: "ja", language: "ja", context: "Technical" },
];

// ─── GLOSSARY (matches your exact columns) ────────────────────────────────────
const glossaryEntries = [
    // en → hi_IN
    { source_term: "API", target_term: "एपीआई", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    { source_term: "database", target_term: "डेटाबेस", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    { source_term: "authentication", target_term: "प्रमाणीकरण", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    { source_term: "upload", target_term: "अपलोड", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    { source_term: "download", target_term: "डाउनलोड", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    { source_term: "server", target_term: "सर्वर", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    { source_term: "translation", target_term: "अनुवाद", source_lang: "en", target_lang: "hi_IN", language: "hi_IN", domain: "technical", is_mandatory: 1 },
    // en → fr
    { source_term: "API", target_term: "API", source_lang: "en", target_lang: "fr", language: "fr", domain: "technical", is_mandatory: 1 },
    { source_term: "database", target_term: "base de données", source_lang: "en", target_lang: "fr", language: "fr", domain: "technical", is_mandatory: 1 },
    { source_term: "authentication", target_term: "authentification", source_lang: "en", target_lang: "fr", language: "fr", domain: "technical", is_mandatory: 1 },
    { source_term: "translation", target_term: "traduction", source_lang: "en", target_lang: "fr", language: "fr", domain: "technical", is_mandatory: 1 },
    // en → es
    { source_term: "API", target_term: "API", source_lang: "en", target_lang: "es", language: "es", domain: "technical", is_mandatory: 1 },
    { source_term: "database", target_term: "base de datos", source_lang: "en", target_lang: "es", language: "es", domain: "technical", is_mandatory: 1 },
    { source_term: "authentication", target_term: "autenticación", source_lang: "en", target_lang: "es", language: "es", domain: "technical", is_mandatory: 1 },
    { source_term: "translation", target_term: "traducción", source_lang: "en", target_lang: "es", language: "es", domain: "technical", is_mandatory: 1 },
    // en → de
    { source_term: "API", target_term: "API", source_lang: "en", target_lang: "de", language: "de", domain: "technical", is_mandatory: 1 },
    { source_term: "database", target_term: "Datenbank", source_lang: "en", target_lang: "de", language: "de", domain: "technical", is_mandatory: 1 },
    { source_term: "authentication", target_term: "Authentifizierung", source_lang: "en", target_lang: "de", language: "de", domain: "technical", is_mandatory: 1 },
    { source_term: "translation", target_term: "Übersetzung", source_lang: "en", target_lang: "de", language: "de", domain: "technical", is_mandatory: 1 },
];

// ─── INSERT ───────────────────────────────────────────────────────────────────
const insertTM = db.prepare(`
  INSERT OR IGNORE INTO tm_records 
    (source_text, target_text, source_lang, target_lang, language, context, approved_by)
  VALUES (?, ?, ?, ?, ?, ?, 'seed')
`);

const insertGlossary = db.prepare(`
  INSERT OR IGNORE INTO glossary 
    (source_term, target_term, source_lang, target_lang, language, domain, is_mandatory)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const seedAll = db.transaction(() => {
    for (const e of tmEntries) {
        insertTM.run(e.source_text, e.target_text, e.source_lang, e.target_lang, e.language, e.context);
    }
    for (const e of glossaryEntries) {
        insertGlossary.run(e.source_term, e.target_term, e.source_lang, e.target_lang, e.language, e.domain, e.is_mandatory);
    }
});

seedAll();

// Verify
const tmCount = db.prepare("SELECT COUNT(*) as total FROM tm_records").get();
const glossaryCount = db.prepare("SELECT COUNT(*) as total FROM glossary").get();

console.log(`✅ TM records in database: ${tmCount.total} (was 9, added ${tmCount.total - 9} new)`);
console.log(`✅ Glossary entries in database: ${glossaryCount.total} (was 17, added ${glossaryCount.total - 17} new)`);
console.log(`\n📊 Language pairs now available:`);

const langs = db.prepare("SELECT DISTINCT target_lang, COUNT(*) as count FROM tm_records GROUP BY target_lang").all();
langs.forEach(l => console.log(`   ${l.target_lang}: ${l.count} entries`));

db.close();
console.log('\n🎉 Database ready for hackathon demo!');