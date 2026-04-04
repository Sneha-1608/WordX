import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/export-tm/tmx/:language — TMX Export (Improvement 6)
//
// Generates TMX 1.4 XML from the translation memory for a
// given language pair.
// ═══════════════════════════════════════════════════════════════

router.get('/tmx/:language', (req, res) => {
  try {
    const lang = req.params.language;
    const records = db.prepare(
      `SELECT source_text, target_text, source_lang, target_lang, approved_at, context
       FROM tm_records WHERE target_lang = ? ORDER BY id`
    ).all(lang);

    const srcLang = records[0]?.source_lang || 'en';

    let tmx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    tmx += `<!DOCTYPE tmx SYSTEM "tmx14.dtd">\n`;
    tmx += `<tmx version="1.4">\n`;
    tmx += `  <header\n`;
    tmx += `    creationtool="ClearLingo"\n`;
    tmx += `    creationtoolversion="2.0"\n`;
    tmx += `    segtype="sentence"\n`;
    tmx += `    o-tmf="ClearLingo-TM"\n`;
    tmx += `    adminlang="${srcLang}"\n`;
    tmx += `    srclang="${srcLang}"\n`;
    tmx += `    datatype="plaintext"\n`;
    tmx += `  />\n`;
    tmx += `  <body>\n`;

    for (const rec of records) {
      tmx += `    <tu>\n`;
      if (rec.context) {
        tmx += `      <prop type="x-context">${escapeXml(rec.context)}</prop>\n`;
      }
      tmx += `      <tuv xml:lang="${rec.source_lang}">\n`;
      tmx += `        <seg>${escapeXml(rec.source_text)}</seg>\n`;
      tmx += `      </tuv>\n`;
      tmx += `      <tuv xml:lang="${rec.target_lang}">\n`;
      tmx += `        <seg>${escapeXml(rec.target_text)}</seg>\n`;
      tmx += `      </tuv>\n`;
      tmx += `    </tu>\n`;
    }

    tmx += `  </body>\n`;
    tmx += `</tmx>\n`;

    res.setHeader('Content-Type', 'application/x-tmx+xml');
    res.setHeader('Content-Disposition', `attachment; filename="clearlingo-tm-${lang}.tmx"`);
    res.send(tmx);
  } catch (err) {
    console.error('TMX export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/export-tm/xliff/:projectId — XLIFF 2.1 Export (Improvement 6)
//
// Generates XLIFF 2.1 from a project's segments for exchange
// with other CAT tools.
// ═══════════════════════════════════════════════════════════════

router.get('/xliff/:projectId', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const segments = db.prepare(
      'SELECT * FROM segments WHERE project_id = ? ORDER BY idx ASC'
    ).all(projectId);

    const srcLang = project.source_language || 'en';
    const tgtLang = project.target_language || 'hi_IN';

    let xliff = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xliff += `<xliff version="2.1" xmlns="urn:oasis:names:tc:xliff:document:2.1"\n`;
    xliff += `       srcLang="${srcLang}" trgLang="${tgtLang}">\n`;
    xliff += `  <file id="f1" original="${escapeXml(project.name)}">\n`;

    for (const seg of segments) {
      const state = seg.status === 'APPROVED' ? 'final' : seg.status === 'REJECTED' ? 'needs-review-translation' : 'initial';
      xliff += `    <unit id="${seg.id}">\n`;
      if (seg.match_type) {
        xliff += `      <notes>\n`;
        xliff += `        <note category="match-type">${seg.match_type}</note>\n`;
        if (seg.tm_score !== null) {
          xliff += `        <note category="tm-score">${seg.tm_score}</note>\n`;
        }
        xliff += `      </notes>\n`;
      }
      xliff += `      <segment state="${state}">\n`;
      xliff += `        <source>${escapeXml(seg.source_text)}</source>\n`;
      xliff += `        <target>${escapeXml(seg.target_text || '')}</target>\n`;
      xliff += `      </segment>\n`;
      xliff += `    </unit>\n`;
    }

    xliff += `  </file>\n`;
    xliff += `</xliff>\n`;

    res.setHeader('Content-Type', 'application/xliff+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/[^a-zA-Z0-9]/g, '_')}.xliff"`);
    res.send(xliff);
  } catch (err) {
    console.error('XLIFF export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/export-tm/stats — TM Export Summary
// ═══════════════════════════════════════════════════════════════

router.get('/stats', (req, res) => {
  try {
    const byLang = db.prepare(
      `SELECT target_lang, COUNT(*) as count FROM tm_records GROUP BY target_lang ORDER BY count DESC`
    ).all();

    const total = byLang.reduce((s, r) => s + r.count, 0);

    res.json({ total, byLanguage: byLang });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
