import React, { useState } from 'react';
import { ChevronRight, CheckCircle2, Check, ArrowRight } from 'lucide-react';

const HumanApproval = ({ onComplete, targetLang, targetLangCode, segments = [], projectId }) => {
  const [approvedCount, setApprovedCount] = useState(0);
  const [approvedIds, setApprovedIds] = useState(new Set());
  const [editedSegments, setEditedSegments] = useState({});

  const progress = segments.length > 0 ? Math.round((approvedCount / segments.length) * 100) : 0;

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
        setApprovedIds(prev => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        setApprovedCount(c => c + 1);
      } else {
        // Simple local toggle off for UI fluidity
        setApprovedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
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
      const allIds = new Set(segments.map(s => s.id));
      setApprovedIds(allIds);
      setApprovedCount(segments.length);
    } catch (err) {
      console.error('Bulk approval failed:', err);
    }
  };

  const handleTextChange = (id, val) => {
    setEditedSegments(prev => ({ ...prev, [id]: val }));
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

      <div className="approval-table glass-panel">
        <div className="table-header">
          <div className="col-idx">#</div>
          <div className="col-text">Original Text</div>
          <div className="col-sep"></div>
          <div className="col-text">Translated Output</div>
          <div className="col-action"></div>
        </div>

        <div className="table-body">
          {segments.map((seg, idx) => (
            <div key={seg.id} className={`table-row ${approvedIds.has(seg.id) ? 'approved' : ''}`}>
              <div className="col-idx">{idx + 1}</div>
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
          ))}
        </div>
      </div>

      <div className="approval-footer">
        <button 
          className={`finalize-btn ${approvedCount < segments.length ? 'disabled' : ''}`}
          onClick={onComplete}
          disabled={approvedCount < segments.length}
        >
          Finalize & Export <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default HumanApproval;
