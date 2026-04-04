import React, { useState, useEffect, useRef } from 'react';
import { Check, CheckCircle2, ChevronRight, AlertCircle, ArrowRight } from 'lucide-react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

const mockSegments = [
  {
    id: 1,
    original: "Artificial intelligence (AI) is intelligence demonstrated by machines, as opposed to the natural intelligence displayed by animals including humans.",
    translated: "La inteligencia artificial (IA) es la inteligencia demostrada por las máquinas, a diferencia de la inteligencia natural mostrada por los animales, incluidos los humanos."
  },
  {
    id: 2,
    original: "Leading AI textbooks define the field as the study of \"intelligent agents\": any system that perceives its environment and takes actions that maximize its chance of achieving its goals.",
    translated: "Los principales libros de texto de IA definen el campo como el estudio de \"agentes inteligentes\": cualquier sistema que percibe su entorno y toma acciones que maximizan sus posibilidades de lograr sus objetivos."
  },
  {
    id: 3,
    original: "Some popular accounts use the term \"artificial intelligence\" to describe machines that mimic \"cognitive\" functions that humans associate with the human mind, such as \"learning\" and \"problem solving\".",
    translated: "Algunos relatos populares utilizan el término \"inteligencia artificial\" para describir máquinas que imitan funciones \"cognitivas\" que los humanos asocian con la mente humana, como \"aprender\" y \"resolver problemas\"."
  }
];

export default function ReviewEditor({ onApproveAll, targetLang }) {
  const [segments, setSegments] = useState(
    mockSegments.map(s => ({ ...s, isApproved: false }))
  );

  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const ymapRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('Connecting...');

  useEffect(() => {
    ydocRef.current = new Y.Doc();
    providerRef.current = new WebrtcProvider('wordx-translation-review', ydocRef.current);
    ymapRef.current = ydocRef.current.getMap('segments');

    providerRef.current.on('status', event => {
      setSyncStatus(event.status === 'connected' ? 'Synced remotely' : 'Disconnected');
    });

    ymapRef.current.observe(() => {
      // Yjs real-time remote updates received here
      // For demonstration, we just acknowledge receipt
      console.log('Yjs synced segment update from remote peer');
    });

    return () => {
      providerRef.current.destroy();
      ydocRef.current.destroy();
    };
  }, []);

  const handleTextChange = (id, newText) => {
    // Local state update
    setSegments(segments.map(s => 
      s.id === id ? { ...s, translated: newText, isApproved: false } : s
    ));
    
    // Broadcast via Yjs
    if (ymapRef.current) {
      ymapRef.current.set(`seg_${id}`, newText);
    }
  };

  const toggleApproval = (id) => {
    setSegments(segments.map(s => 
      s.id === id ? { ...s, isApproved: !s.isApproved } : s
    ));
  };

  const getProgress = () => {
    const approved = segments.filter(s => s.isApproved).length;
    return Math.round((approved / segments.length) * 100);
  };

  const handleApproveAll = () => {
    if (getProgress() === 100) {
      onApproveAll();
    } else {
      setSegments(segments.map(s => ({ ...s, isApproved: true })));
    }
  };

  return (
    <div className="review-editor fade-in">
      <div className="review-header">
        <div style={{ textAlign: 'left' }}>
          <h2 className="status-title" style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Human Approval Queue</h2>
          <p className="status-desc" style={{ marginBottom: 0 }}>Review and modify segments before database sync.</p>
        </div>
        <div className="review-stats">
          <div className="stat-pill" style={{ background: syncStatus.includes('Synced') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: syncStatus.includes('Synced') ? '#10b981' : '#f59e0b', border: 'none' }}>
            <span className="stat-label">Yjs Status: </span>
            <span className="stat-value">{syncStatus}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">Target</span>
            <span className="stat-value">{targetLang || "Spanish"}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">Progress</span>
            <span className="stat-value">{getProgress()}%</span>
          </div>
        </div>
      </div>

      <div className="editor-container">
        <div className="editor-header-row">
          <div className="editor-col-title">Original Text</div>
          <div className="editor-col-title">Translated Output</div>
        </div>

        <div className="editor-content">
          {segments.map((seg, idx) => (
            <div key={seg.id} className={`segment-row ${seg.isApproved ? 'approved' : ''}`}>
              <div className="segment-number">{idx + 1}</div>
              
              <div className="segment-col original-col">
                <p>{seg.original}</p>
              </div>
              
              <div className="segment-indicator">
                <ChevronRight size={16} className="indicator-icon" />
              </div>
              
              <div className="segment-col translated-col">
                <textarea 
                  className="segment-textarea"
                  value={seg.translated}
                  onChange={(e) => handleTextChange(seg.id, e.target.value)}
                  disabled={seg.isApproved}
                />
                
                <button 
                  className={`segment-approve-btn ${seg.isApproved ? 'active' : ''}`}
                  onClick={() => toggleApproval(seg.id)}
                  title={seg.isApproved ? "Revoke Approval" : "Approve Segment"}
                >
                  {seg.isApproved ? <CheckCircle2 size={18} /> : <Check size={18} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="review-footer">
        <div className="footer-info">
          {getProgress() === 100 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-color)' }}>
              <CheckCircle2 size={18}/> All segments approved
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <AlertCircle size={18}/> {segments.length - segments.filter(s=>s.isApproved).length} segments pending review
            </span>
          )}
        </div>
        <button 
          className={`translate-btn ${getProgress() === 100 ? 'ready' : ''}`}
          onClick={handleApproveAll}
          style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
        >
          {getProgress() === 100 ? "Sync to Database" : "Approve All Remaining"}
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
