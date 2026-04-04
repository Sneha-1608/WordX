import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, ArrowRight, Settings, CheckCircle2, ChevronDown, FileText, RefreshCw, Search, Plus, Home, BarChart3, Sun, Moon, Download } from 'lucide-react';
import Analytics from './components/Analytics';
import HumanApproval from './components/HumanApproval';
import DocumentVerification from './components/DocumentVerification';
import WaveLines from './components/WaveLines';
import './index.css';

const languages = [
  { code: 'hi_IN', name: 'Hindi' }, { code: 'es_ES', name: 'Spanish' },
  { code: 'fr_FR', name: 'French' }, { code: 'de_DE', name: 'German' },
  { code: 'zh_CN', name: 'Chinese' }, { code: 'ja_JP', name: 'Japanese' },
  { code: 'ko_KR', name: 'Korean' }, { code: 'ru_RU', name: 'Russian' },
  { code: 'ar_SA', name: 'Arabic' }, { code: 'ta_IN', name: 'Tamil' },
  { code: 'te_IN', name: 'Telugu' }, { code: 'gu_IN', name: 'Gujarati' },
  { code: 'mr_IN', name: 'Marathi' }, { code: 'bn_IN', name: 'Bengali' }
];

function App() {
  const [selectedLang, setSelectedLang] = useState('');
  const [file, setFile] = useState(null);
  const [appState, setAppState] = useState('idle'); // idle, uploading, verifying, translating, approving, done
  const [progress, setProgress] = useState(0);
  const [projectId, setProjectId] = useState(null);
  const [segments, setSegments] = useState([]);
  const [activeTab, setActiveTab] = useState('home'); // home, approval, analytics
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
    } catch(err) {
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
          streamedBuffer = parts.pop(); // keep partial chunk

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
    } catch(err) {
      console.error(err);
      alert('Error translating: ' + err.message);
      resetState();
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
      <div className="background-shapes">
        <WaveLines />
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>

      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="logo" onClick={() => setActiveTab('home')} style={{ cursor: 'pointer' }}>
            <div className="logo-icon">V</div>
            <span className="logo-text">Verb AI</span>
          </div>

          <div className="nav-links">
            <button
              className={`nav-link ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => setActiveTab('home')}
            >
              <Home size={16} /> Home
            </button>
            <button
              className={`nav-link ${activeTab === 'approval' ? 'active' : ''}`}
              onClick={() => setActiveTab('approval')}
            >
              <CheckCircle2 size={16} /> Human Approval
            </button>
            <button
              className={`nav-link ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              <BarChart3 size={16} /> Analytics
            </button>
          </div>
        </div>

        <div className="nav-actions">
          <button
            className="icon-button"
            onClick={() => setIsDarkTheme(!isDarkTheme)}
            style={{ marginRight: '0.5rem' }}
          >
            {isDarkTheme ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button className="icon-button"><Settings size={20} /></button>
        </div>
      </nav>

      <main className="main-content">
        {activeTab === 'analytics' && <Analytics />}

        {activeTab === 'approval' && (
          <HumanApproval
            targetLang={selectedLang ? languages.find(l=>l.code===selectedLang)?.name : ''}
            targetLangCode={selectedLang}
            segments={segments}
            projectId={projectId}
            onComplete={() => {
              setAppState('done');
              setActiveTab('home'); // Go back to Home for download
            }}
          />
        )}

        {activeTab === 'home' && (
          <>
            {appState === 'verifying' ? (
              <DocumentVerification
                fileName={file?.name}
                onComplete={() => {
                  runTranslationPipeline();
                }}
              />
            ) : appState === 'approving' ? (
              <div className="approving-indicator fade-in">
                <div className="indicator-card glass-panel">
                  <CheckCircle2 size={32} className="text-secondary" />
                  <h3>Translation Ready for Review</h3>
                  <p>Please check the **Human Approval** tab to approve segments.</p>
                  <button className="finalize-btn" onClick={() => setActiveTab('approval')}>
                    Open Approval <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header className="hero">
                  <h1 className="title">Break Language Barriers <br /> <span className="highlight">Instantly.</span></h1>
                </header>

                <div className="app-card glass-panel">
                  {appState === 'idle' && (
                    <div className="compact-interface fade-in">
                      <div className="compact-box vertical">
                        <label className={`compact-row-upload ${file ? 'has-file' : ''}`}>
                          <input type="file" className="file-input" onChange={handleFileChange} />
                          <div className="icon-wrap">
                            {file ? <FileText size={20} className="text-primary" /> : <Plus size={20} />}
                          </div>
                          <span className="compact-label">{file ? file.name : "Add your document..."}</span>
                        </label>

                        <div className="horizontal-divider"></div>

                        <div className="compact-row-lang" ref={dropdownRef}>
                          <div
                            className="compact-picker-trigger"
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                          >
                            <div className="picker-label-wrap">
                              <Settings size={16} className="text-secondary" />
                              <span>{selectedLang ? languages.find(l=>l.code===selectedLang)?.name : "Translate to..."}</span>
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
                            <span>PDF, DOCX, TXT</span>
                            <span className="dot"></span>
                            <span>Max 50MB</span>
                            <span className="dot"></span>
                            <span className="secure"><CheckCircle2 size={12} /> Secure</span>
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
                        {appState === 'uploading' ? 'Uploading & Parsing Document...' : `Translating Document...`}
                      </h2>
                      {appState === 'uploading' && <p className="status-desc">{file?.name}</p>}
                      {appState === 'uploading' && (
                        <div className="progress-bar-container">
                          <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }}></div>
                          <span className="progress-text">{Math.min(progress, 100)}%</span>
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
                      <p className="status-desc">Your document has been successfully translated to {selectedLang}.</p>
                      <div className="result-card fade-in">
                        <div className="file-info-small">
                          <FileText size={32} className="text-primary" />
                          <div>
                            <p className="res-name">{file?.name}</p>
                            <p className="res-size">Ready for download &middot; 100% Accuracy</p>
                          </div>
                        </div>
                        <button className="download-btn">
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
