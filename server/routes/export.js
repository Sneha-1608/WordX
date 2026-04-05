import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  NumberFormat, LevelFormat, AlignmentType,
} from 'docx';
import db from '../db.js';
import { buildAlignedRuns } from '../parsers/docx-structured.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/export — Format-Aware Document Reconstruction
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  try {
    const { projectId, language = 'hi_IN', format = 'docx', preserveInlineFormatting = true } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId required' });
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Fetch approved segments ordered by index, with format metadata
    const segments = db.prepare(
      `SELECT * FROM segments WHERE project_id = ? AND status = 'APPROVED' ORDER BY idx ASC`
    ).all(projectId);

    if (segments.length === 0) {
      return res.status(400).json({ error: 'Approve at least 1 segment to export.' });
    }

    const cleanProjectName = project.name.replace(/[^a-zA-Z0-9]/g, '_');

    // ═══ TXT Export ═══
    if (format === 'txt') {
      const content = segments.map(s => s.target_text).join('\n\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanProjectName}_translated_${language}.txt"`);
      res.end('\uFEFF' + content, 'utf8'); // Add BOM for Windows
      return;
    }

    // ═══ PDF Export ═══
    if (format === 'pdf') {
      return res.status(400).json({ error: 'PDF export has been deprecated due to font layout constraints. Please export to DOCX.' });
    }

    // ═══ DOCX Export (Default) ═══
    // Process segments — some may need async run alignment
    const paragraphs = [];
    for (const seg of segments) {
      const formatType = seg.format_type || 'paragraph';
      const text = seg.target_text;

      // ═══ DeepTrans: If we have original run metadata, reconstruct with original formatting ═══
      let runsData = null;
      try {
        runsData = seg.runs_metadata ? JSON.parse(seg.runs_metadata) : null;
      } catch {}

      if (runsData && runsData.length > 0) {
        // Check if there's actually varied formatting across runs
        const hasVariedFormatting = preserveInlineFormatting && runsData.length > 1 && runsData.some(
          (r, i, arr) => i > 0 && (
            r.bold !== arr[0].bold ||
            r.italic !== arr[0].italic ||
            r.underline !== arr[0].underline ||
            r.color !== arr[0].color
          )
        );

        if (hasVariedFormatting) {
          // ═══ NEW: Use LLM alignment for multi-run formatting ═══
          try {
            const alignedRuns = await buildAlignedRuns(runsData, text, 'en', language);
            const children = alignedRuns.map(run => new TextRun({
              text: run.text,
              bold: run.bold || false,
              italics: run.italic || false,
              font: run.bold ? 'Arial' : 'Mangal',
              size: run.fontSize || 24,
              color: run.color || undefined,
            }));
            paragraphs.push(new Paragraph({
              children,
              heading: formatType === 'heading' ? HeadingLevel.HEADING_1 : undefined,
              spacing: { before: 120, after: 120 },
            }));
            console.log(`   🎨 Aligned ${alignedRuns.length} runs for segment "${text.substring(0, 40)}..."`);
            continue;
          } catch (alignErr) {
            console.warn(`   ⚠ Run alignment failed, falling back to single-run: ${alignErr.message}`);
            // Fall through to single-run approach below
          }
        }

        // Apply first run's formatting to entire translated text (single-run fallback)
        const primaryRun = runsData[0];
        paragraphs.push(new Paragraph({
          children: [
            new TextRun({
              text,
              bold: primaryRun.bold || false,
              italics: primaryRun.italic || false,
              font: primaryRun.bold ? 'Arial' : 'Mangal',
              size: primaryRun.fontSize || 24,
              color: primaryRun.color || undefined,
            }),
          ],
          heading: formatType === 'heading' ? HeadingLevel.HEADING_1 : undefined,
          spacing: { before: 120, after: 120 },
        }));
        continue;
      }

      // ═══ Fallback: existing format-type-based export ═══
      switch (formatType) {
        case 'heading':
          paragraphs.push(new Paragraph({
            children: [
              new TextRun({
                text,
                bold: true,
                font: 'Arial',
                size: 28,  // 14pt
              }),
            ],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }));
          break;

        case 'list_item':
        case 'bullet_list':
          paragraphs.push(new Paragraph({
            children: [
              new TextRun({
                text: `• ${text}`,
                font: 'Mangal',
                size: 24,
              }),
            ],
            spacing: { before: 80, after: 80 },
            indent: { left: 720 },  // 0.5 inch indent
          }));
          break;

        case 'numbered_list':
          paragraphs.push(new Paragraph({
            children: [
              new TextRun({
                text,
                font: 'Mangal',
                size: 24,
              }),
            ],
            spacing: { before: 80, after: 80 },
            indent: { left: 720 },
          }));
          break;

        case 'blockquote':
          paragraphs.push(new Paragraph({
            children: [
              new TextRun({
                text,
                font: 'Mangal',
                size: 24,
                italics: true,
                color: '444444',
              }),
            ],
            spacing: { before: 160, after: 160 },
            indent: { left: 720, right: 720 },
          }));
          break;

        case 'paragraph':
        default:
          paragraphs.push(new Paragraph({
            children: [
              new TextRun({
                text,
                font: 'Mangal',
                size: 24,
              }),
            ],
            spacing: { before: 120, after: 120 },
          }));
          break;
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${project.name} — Translated (${language})`,
                  bold: true,
                  font: 'Arial',
                  size: 32,
                }),
              ],
              heading: HeadingLevel.TITLE,
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Generated by ClearLingo | ${new Date().toLocaleDateString()} | ${segments.length} segments | Format-preserved export`,
                  font: 'Arial',
                  size: 18,
                  color: '666666',
                  italics: true,
                }),
              ],
              spacing: { after: 400 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: '─'.repeat(60),
                  font: 'Arial',
                  size: 16,
                  color: 'CCCCCC',
                }),
              ],
              spacing: { after: 300 },
            }),
            ...paragraphs,
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    const filename = `${cleanProjectName}_translated_${language}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer, 'binary');

    console.log(`📤 Exported ${segments.length} segments as ${filename}`);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

export default router;
