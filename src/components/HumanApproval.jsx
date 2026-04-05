import React, { useState, useEffect } from 'react';
import { ChevronRight, CheckCircle2, Check, ArrowRight, BookOpen, Eye, EyeOff, ChevronDown, ChevronUp, Tag } from 'lucide-react';

const HumanApproval = ({ onComplete, targetLang, targetLangCode, segments = [], projectId }) => {
  const [approvedCount, setApprovedCount] = useState(0);
  const [approvedIds, setApprovedIds] = useState(new Set());
  const [editedSegments, setEditedSegments] = useState({});
  const [glossary, setGlossary] = useState([]);
  const [glossaryLoading, setGlossaryLoading] = useState(false);
  const [showGlossary, setShowGlossary] = useState(true);
  const [showSegmentation, setShowSegmentation] = useState(true);

  const progress = segments.length > 0 ? Math.round((approvedCount / segments.length) * 100) : 0;

  // Fetch live glossary for the target language
  useEffect(() => {
    if (!targetLangCode) return;
    setGlossaryLoading(true);
    fetch(`/api/glossary/${targetLangCode}`)
      .then(r => r.json())
      .then(terms => {
        setGlossary(Array.isArray(terms) ? terms : []);
      })
      .catch(() => setGlossary([]))
      .finally(() => setGlossaryLoading(false));
  }, [targetLangCode]);

  const handleApprove = async (id, originalTarget) => {
    const isApproved = approvedIds.has(id);
    const currentText = editedSegments[id] !== undefined ? editedSegments[id] : originalTarget;

    try {
      if (!isApproved) {
        await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segmentId: id, targetText: currentText, language: targetLangCode })
        });
        setApprovedIds(prev => { const n = new Set(prev); n.add(id); return n; });
        setApprovedCount(c => c + 1);
      } else {
        setApprovedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        setApprovedCount(c => c - 1);
      }
    } catch(err) {
      console.error('Approval failed:', err);
    }
  };

  const handleApproveAll = async () => {
    try {
      await fetch('/api/approve/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, language: targetLangCode })
      });
      setApprovedIds(new Set(segments.map(s => s.id)));
      setApprovedCount(segments.length);
    } catch (err) {
      console.error('Bulk approval failed:', err);
    }
  };

  const handleTextChange = (id, val) => {
    setEditedSegments(prev => ({ ...prev, [id]: val }));
  };

  // Highlight glossary terms in source text
  const highlightGlossaryTerms = (text) => {
    if (!glossary.length || !text) return text;
    return text; // plain text for now; advanced: highlight spans
  };

  // Compute segment type distribution
  const segmentStats = {
    total: segments.length,
    exact: segments.filter(s => s.matchType === 'EXACT').length,
    fuzzy: segments.filter(s => s.matchType === 'FUZZY').length,
    newSegs: segments.filter(s => s.matchType === 'NEW' || !s.matchType).length,
  };

  return (
    <div className="approval-page fade-in">
      <div className="approval-header-row">
        <div className="approval-titles">
          <h1 className="approval-title">Human Approval</h1>
          <p className="approval-desc">Review and modify segments before database sync.</p>
        </div>

        <div className="approval-badges">
          <div className="status-pill language">
            <span className="pill-label">TARGET</span>
            <span className="pill-value">{targetLang || 'Hindi'}</span>
          </div>
          <div className="status-pill progress">
            <span className="pill-label">PROGRESS</span>
            <span className="pill-value">{progress}%</span>
          </div>
          <button
            className="approve-all-btn"
            onClick={handleApproveAll}
            disabled={approvedCount === segments.length}
          >
            <CheckCircle2 size={16} /> Approve All
          </button>
        </div>
      </div>

      {/* Segmentation Summary Panel */}
      {segments.length > 0 && (
        <div className="ha-panel glass-card" style={{ marginBottom: '1.5rem' }}>
          <button
            className="ha-panel-toggle"
            onClick={() => setShowSegmentation(!showSegmentation)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Eye size={18} style={{ color: 'var(--primary-color)' }} />
              <span className="ha-panel-title">Segmentation Overview</span>
              <span className="ha-seg-total-badge">{segmentStats.total} segments</span>
            </div>
            {showSegmentation ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {showSegmentation && (
            <div className="ha-seg-body">
              <div className="ha-seg-stats">
                <div className="ha-seg-stat exact">
                  <span className="ha-seg-count">{segmentStats.exact}</span>
                  <span className="ha-seg-label">Exact Match</span>
                  <span className="ha-seg-pct">
                    {segmentStats.total ? Math.round((segmentStats.exact / segmentStats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="ha-seg-stat fuzzy">
                  <span className="ha-seg-count">{segmentStats.fuzzy}</span>
                  <span className="ha-seg-label">Fuzzy Match</span>
                  <span className="ha-seg-pct">
                    {segmentStats.total ? Math.round((segmentStats.fuzzy / segmentStats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="ha-seg-stat new-seg">
                  <span className="ha-seg-count">{segmentStats.newSegs}</span>
                  <span className="ha-seg-label">AI Translated</span>
                  <span className="ha-seg-pct">
                    {segmentStats.total ? Math.round((segmentStats.newSegs / segmentStats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="ha-seg-stat approved-stat">
                  <span className="ha-seg-count">{approvedCount}</span>
                  <span className="ha-seg-label">Approved</span>
                  <span className="ha-seg-pct">{progress}%</span>
                </div>
              </div>

              {/* Segmentation bar */}
              <div className="ha-seg-bar-wrap">
                <div className="ha-seg-bar">
                  <div className="ha-seg-bar-exact" style={{ width: `${segmentStats.total ? (segmentStats.exact / segmentStats.total) * 100 : 0}%` }} title="Exact" />
                  <div className="ha-seg-bar-fuzzy" style={{ width: `${segmentStats.total ? (segmentStats.fuzzy / segmentStats.total) * 100 : 0}%` }} title="Fuzzy" />
                  <div className="ha-seg-bar-new" style={{ width: `${segmentStats.total ? (segmentStats.newSegs / segmentStats.total) * 100 : 0}%` }} title="New" />
                </div>
                <div className="ha-seg-bar-legend">
                  <span><span className="ha-dot exact-dot" />Exact TM</span>
                  <span><span className="ha-dot fuzzy-dot" />Fuzzy TM</span>
                  <span><span className="ha-dot new-dot" />AI Generated</span>
                </div>
              </div>

              {/* Mini segment list preview */}
              <div className="ha-seg-preview-list">
                {segments.slice(0, 5).map((seg, idx) => (
                  <div key={seg.id} className="ha-seg-preview-item">
                    <span className="ha-seg-preview-idx">{idx + 1}</span>
                    <span className="ha-seg-preview-text">{seg.sourceText?.substring(0, 80)}{seg.sourceText?.length > 80 ? '…' : ''}</span>
                    <span className={`ha-seg-preview-badge ${(seg.matchType || 'NEW').toLowerCase()}`}>
                      {seg.matchType || 'NEW'}
                    </span>
                  </div>
                ))}
                {segments.length > 5 && (
                  <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem' }}>
                    +{segments.length - 5} more segments below
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Glossary Preview */}
      <div className="ha-panel glass-card" style={{ marginBottom: '1.5rem' }}>
        <button
          className="ha-panel-toggle"
          onClick={() => setShowGlossary(!showGlossary)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <BookOpen size={18} style={{ color: '#8b5cf6' }} />
            <span className="ha-panel-title">Live Glossary</span>
            {glossaryLoading ? (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Loading...</span>
            ) : (
              <span className="ha-seg-total-badge" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>
                {glossary.length} terms
              </span>
            )}
          </div>
          {showGlossary ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showGlossary && (
          <div className="ha-glossary-body">
            {glossary.length === 0 && !glossaryLoading ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                <Tag size={24} style={{ opacity: 0.4, marginBottom: '0.5rem', display: 'block', margin: '0 auto 0.5rem' }} />
                No glossary terms found for {targetLang || 'this language'}.
              </div>
            ) : (
              <div className="ha-glossary-grid">
                {glossary.slice(0, 20).map((term, i) => (
                  <div key={i} className="ha-glossary-term">
                    <span className="ha-glossary-source">{term.source}</span>
                    <ChevronRight size={14} style={{ color: 'var(--border-color)', flexShrink: 0 }} />
                    <span className="ha-glossary-target">{term.target}</span>
                  </div>
                ))}
                {glossary.length > 20 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.5rem' }}>
                    +{glossary.length - 20} more terms
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Segments Table */}
      <div className="approval-table glass-panel">
        <div className="table-header">
          <div className="col-idx">#</div>
          <div className="col-text">Original Text</div>
          <div className="col-sep"></div>
          <div className="col-text">Translated Output</div>
          <div className="col-action"></div>
        </div>

        <div className="table-body">
          {segments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
              No segments loaded. Upload and translate a document first.
            </div>
          ) : (
            segments.map((seg, idx) => (
              <div key={seg.id} className={`table-row ${approvedIds.has(seg.id) ? 'approved' : ''}`}>
                <div className="col-idx">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <span>{idx + 1}</span>
                    {seg.matchType && (
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: seg.matchType === 'EXACT' ? 'rgba(16,185,129,0.15)' : seg.matchType === 'FUZZY' ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)',
                        color: seg.matchType === 'EXACT' ? '#10b981' : seg.matchType === 'FUZZY' ? '#3b82f6' : '#f97316',
                      }}>
                        {seg.matchType}
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-text original">
                  {seg.sourceText}
                </div>
                <div className="col-sep">
                  <ChevronRight size={18} />
                </div>
                <div className="col-text translated">
                  <textarea
                    defaultValue={seg.targetText}
                    onChange={(e) => handleTextChange(seg.id, e.target.value)}
                    rows={4}
                    spellCheck={false}
                  />
                </div>
                <div className="col-action">
                  <button
                    className={`approve-btn ${approvedIds.has(seg.id) ? 'active' : ''}`}
                    onClick={() => handleApprove(seg.id, seg.targetText)}
                  >
                    {approvedIds.has(seg.id) ? <CheckCircle2 size={20} /> : <Check size={20} />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="approval-footer">
        <button
          className={`finalize-btn ${approvedCount < segments.length ? 'disabled' : ''}`}
          onClick={onComplete}
          disabled={approvedCount < segments.length}
        >
          Finalize &amp; Export <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default HumanApproval;
