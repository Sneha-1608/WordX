import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, ArrowRight, CheckCircle2, ChevronDown, FileText, RefreshCw, Search, Plus, Home, BarChart3, Sun, Moon, Download, Info, Settings } from 'lucide-react';
import Analytics from './components/Analytics';
import HumanApproval from './components/HumanApproval';
import DocumentVerification from './components/DocumentVerification';
import AboutUs from './components/AboutUs';
import Silk from './components/Silk';
import TargetCursor from './components/TargetCursor';
import './index.css';

const languages = [
  { code: 'hi_IN', name: 'Hindi' }, { code: 'es_ES', name: 'Spanish' },
  { code: 'fr_FR', name: 'French' }, { code: 'de_DE', name: 'German' },
  { code: 'zh_CN', name: 'Chinese' }, { code: 'ja_JP', name: 'Japanese' },
  { code: 'ko_KR', name: 'Korean' }, { code: 'ru_RU', name: 'Russian' },
  { code: 'ar_SA', name: 'Arabic' }, { code: 'ta_IN', name: 'Tamil' },
  { code: 'te_IN', name: 'Telugu' }, { code: 'gu_IN', name: 'Gujarati' },
  { code: 'mr_IN', name: 'Marathi' }, { code: 'bn_IN', name: 'Bengali' },
  { code: 'kn_IN', name: 'Kannada' }, { code: 'ml_IN', name: 'Malayalam' },
  { code: 'pa_IN', name: 'Punjabi' }, { code: 'or_IN', name: 'Odia' },
  { code: 'ur_PK', name: 'Urdu' }, { code: 'ne_NP', name: 'Nepali' },
];

function App() {
  const [selectedLang, setSelectedLang] = useState('');
  const [file, setFile] = useState(null);
  const [appState, setAppState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [projectId, setProjectId] = useState(null);
  const [segments, setSegments] = useState([]);
  const [activeTab, setActiveTab] = useState('home');
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDarkTheme]);

  const filteredLanguages = languages.filter(lang =>
    lang.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const startTranslation = async () => {
    setAppState('uploading');
    setProgress(20);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language', selectedLang);
      const res = await fetch('/api/parse', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parsing failed');
      setProjectId(data.projectId);
      setSegments(data.segments || []);
      setProgress(100);
      setAppState('verifying');
    } catch (err) {
      console.error(err);
      alert('Error parsing document: ' + err.message);
      resetState();
    }
  };

  const runTranslationPipeline = async () => {
    setAppState('translating');
    setProgress(0);
    try {
      const res = await fetch('/api/translate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, segments, targetLang: selectedLang })
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let streamedBuffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          streamedBuffer += decoder.decode(value, { stream: true });
          const parts = streamedBuffer.split('\n\n');
          streamedBuffer = parts.pop();
          for (const p of parts) {
            if (p.trim().startsWith('data:')) {
              try {
                const msg = JSON.parse(p.substring(5).trim());
                if (msg.type === 'segment_done') {
                  setProgress(Math.round((msg.current / msg.total) * 100));
                  setSegments(prev => prev.map(s =>
                    s.id === msg.segmentId ? { ...s, targetText: msg.translatedText } : s
                  ));
                } else if (msg.type === 'complete') {
                  setTimeout(() => {
                    setAppState('approving');
                    setActiveTab('approval');
                  }, 1000);
                } else if (msg.type === 'error' || msg.type === 'segment_error') {
                  console.warn('Translation issue:', msg);
                }
              } catch (e) {
                console.error('Failed to parse SSE payload', e);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      alert('Error translating: ' + err.message);
      resetState();
    }
  };

  const handleDownload = async () => {
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, language: selectedLang, format: 'docx' })
      });
      if (!res.ok) {
        let errMsg = 'Export failed';
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch { }
        throw new Error(errMsg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated_${selectedLang}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Download failed: ' + err.message);
    }
  };

  const resetState = () => {
    setAppState('idle');
    setFile(null);
    setSelectedLang('');
    setProgress(0);
    setProjectId(null);
    setSegments([]);
  };

  return (
    <div className="container">
      <TargetCursor targetSelector=".cursor-target" spinDuration={5} parallaxOn={false} hoverDuration={0.2} />

      <div className="silk-background">
        <Silk
          speed={3}
          scale={1}
          color={isDarkTheme ? '#059825ff' : '#a7f3d0ff'}
          noiseIntensity={0.6}
          rotation={2}
        />
      </div>

      {/* Wave overlay for light mode */}
      {!isDarkTheme && <div className="wave-overlay" />}

      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="logo" onClick={() => setActiveTab('home')} style={{ cursor: 'pointer' }}>
            <div className="logo-icon">V</div>
            <span className="logo-text">Verb AI</span>
          </div>

          <div className="nav-links">
            <button
              className={`nav-link cursor-target ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => setActiveTab('home')}
            >
              <Home size={16} /> Home
            </button>
            <button
              className={`nav-link cursor-target ${activeTab === 'approval' ? 'active' : ''}`}
              onClick={() => setActiveTab('approval')}
            >
              <CheckCircle2 size={16} /> Human Approval
            </button>
            <button
              className={`nav-link cursor-target ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              <BarChart3 size={16} /> Analytics
            </button>
            <button
              className={`nav-link cursor-target ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <Info size={16} /> About
            </button>
          </div>
        </div>

        <div className="nav-actions">
          <button
            className="icon-button cursor-target"
            onClick={() => setIsDarkTheme(!isDarkTheme)}
            title={isDarkTheme ? 'Switch to Light' : 'Switch to Dark'}
          >
            {isDarkTheme ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </nav>

      <main className="main-content">
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'about' && <AboutUs />}

        {activeTab === 'approval' && (
          <HumanApproval
            targetLang={selectedLang ? languages.find(l => l.code === selectedLang)?.name : ''}
            targetLangCode={selectedLang}
            segments={segments}
            projectId={projectId}
            onComplete={() => {
              setAppState('done');
              setActiveTab('home');
            }}
          />
        )}

        {activeTab === 'home' && (
          <>
            {appState === 'verifying' ? (
              <DocumentVerification
                fileName={file?.name}
                onComplete={() => runTranslationPipeline()}
              />
            ) : appState === 'approving' ? (
              <div className="approving-indicator fade-in">
                <div className="indicator-card glass-panel">
                  <CheckCircle2 size={32} className="text-secondary" />
                  <h3>Translation Ready for Review</h3>
                  <p>Please check the <strong>Human Approval</strong> tab to approve segments.</p>
                  <button className="finalize-btn" onClick={() => setActiveTab('approval')}>
                    Open Approval <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header className="hero">
                  <h1 className="title">
                    Break Language Barriers <br />
                    <span className="highlight">Instantly.</span>
                  </h1>
                </header>

                <div className="app-card glass-panel">
                  {appState === 'idle' && (
                    <div className="compact-interface fade-in">
                      <div
                        className="compact-box vertical"
                        onDragOver={e => e.preventDefault()}
                        onDrop={handleDrop}
                      >
                        <label className={`compact-row-upload ${file ? 'has-file' : ''}`}>
                          <input type="file" className="file-input" onChange={handleFileChange} accept=".pdf,.docx,.doc" />
                          <div className="icon-wrap">
                            {file ? <FileText size={20} className="text-primary" /> : <Plus size={20} />}
                          </div>
                          <span className="compact-label">{file ? file.name : 'Add your document...'}</span>
                        </label>

                        <div className="horizontal-divider"></div>

                        <div className="compact-row-lang" ref={dropdownRef}>
                          <div
                            className="compact-picker-trigger"
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                          >
                            <div className="picker-label-wrap">
                              <Settings size={16} className="text-secondary" />
                              <span>{selectedLang ? languages.find(l => l.code === selectedLang)?.name : 'Translate to...'}</span>
                            </div>
                            <ChevronDown size={16} className={isDropdownOpen ? 'rotate' : ''} />
                          </div>

                          {isDropdownOpen && (
                            <div className="compact-dropdown fade-in">
                              <div className="dropdown-search">
                                <Search size={14} className="search-icon" />
                                <input
                                  type="text"
                                  placeholder="Search languages..."
                                  value={searchQuery}
                                  onChange={(e) => setSearchQuery(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <ul className="dropdown-options">
                                {filteredLanguages.map(lang => (
                                  <li
                                    key={lang.code}
                                    className={`dropdown-option ${selectedLang === lang.code ? 'selected' : ''}`}
                                    onClick={() => {
                                      setSelectedLang(lang.code);
                                      setIsDropdownOpen(false);
                                      setSearchQuery('');
                                    }}
                                  >
                                    {lang.name}
                                    {selectedLang === lang.code && <CheckCircle2 size={16} className="selected-icon" />}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        <div className="compact-box-footer">
                          <div className="compact-hints">
                            <span>PDF, DOCX</span>
                            <span className="dot"></span>
                            <span>Max 10MB</span>
                          </div>

                          <button
                            className={`compact-start-btn ${(!file || !selectedLang) ? 'disabled' : ''}`}
                            onClick={(!file || !selectedLang) ? undefined : startTranslation}
                            title="Start Translation"
                          >
                            <ArrowRight size={22} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {(appState === 'uploading' || appState === 'translating') && (
                    <div className="processing-state fade-in">
                      <div className="loader-container">
                        <div className="animated-ring"></div>
                        {appState === 'uploading' ? (
                          <UploadCloud size={32} className="pulse-icon text-primary" />
                        ) : (
                          <RefreshCw size={32} className="spin-icon text-secondary" />
                        )}
                      </div>
                      <h2 className="status-title">
                        {appState === 'uploading' ? 'Uploading & Parsing Document...' : 'Translating Document...'}
                      </h2>
                      {appState === 'uploading' && <p className="status-desc">{file?.name}</p>}
                      {appState === 'uploading' && (
                        <div className="progress-bar-container">
                          <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }}></div>
                          <span className="progress-text">{Math.min(progress, 100)}%</span>
                        </div>
                      )}
                      {appState === 'translating' && (
                        <div className="progress-bar-container">
                          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                          <span className="progress-text">{progress}%</span>
                        </div>
                      )}
                    </div>
                  )}

                  {appState === 'done' && (
                    <div className="success-state fade-in">
                      <div className="success-icon-large">
                        <CheckCircle2 size={48} />
                      </div>
                      <h2 className="status-title">Translation Complete!</h2>
                      <p className="status-desc">
                        Your document has been successfully translated to {languages.find(l => l.code === selectedLang)?.name || selectedLang}.
                      </p>
                      <div className="result-card fade-in">
                        <div className="file-info-small">
                          <FileText size={32} className="text-primary" />
                          <div>
                            <p className="res-name">{file?.name}</p>
                            <p className="res-size">Ready for download &middot; {segments.length} segments</p>
                          </div>
                        </div>
                        <button className="download-btn" onClick={handleDownload}>
                          <Download size={20} /> Download
                        </button>
                      </div>
                      <button className="text-btn mt-4 fade-in" onClick={resetState}>
                        Translate another document
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
