import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, FileText, X, AlertCircle, CheckCircle2, ArrowRight, Sparkles, Paperclip, ArrowUp, Zap, Shield, FileOutput, Key, Globe } from 'lucide-react';
import { Button } from '../components/Button';
import { useAppStore, Language } from '../store';
import { toast, Toaster } from 'sonner';

// ═══════════════════════════════════════════════════════════════
// Language groups for the dropdown
// ═══════════════════════════════════════════════════════════════
const REGION_LABELS: Record<string, string> = {
  source: '── Source ──',
  indian: '── Indian Languages ──',
  european: '── European Languages ──',
  asian: '── East Asian ──',
  other: '── Other ──',
};

export default function DocumentUpload() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsePhase, setParsePhase] = useState<'idle' | 'parsing' | 'translating'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const {
    setProject, setSegments, setIsParsing, isParsing, setGlossary,
    sourceLanguage, activeLanguage, languages,
    setSourceLanguage, setActiveLanguage, setLanguages,
  } = useAppStore();

  // Fetch supported languages from API
  useEffect(() => {
    fetch('/api/languages')
      .then(res => res.json())
      .then(langs => setLanguages(langs))
      .catch(err => console.warn('Failed to load languages:', err));
  }, []);

  const SUPPORTED_FORMATS = new Set(['docx', 'pdf']);

  const validateFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_FORMATS.has(ext)) {
      toast.error(`Unsupported format: .${ext}. We only accept DOCX and PDF files.`, {
        duration: 4000,
        icon: <AlertCircle className="w-5 h-5" />,
      });
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB.', { duration: 4000 });
      return false;
    }
    return true;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Get display name for a language code
  const getLangName = (code: string): string => {
    const lang = languages.find(l => l.code === code);
    return lang ? `${lang.flag} ${lang.name}` : code;
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    if (sourceLanguage === activeLanguage) {
      toast.error('Source and target language must be different.', { duration: 3000 });
      return;
    }

    setIsParsing(true);
    setParsePhase('parsing');

    try {
      // ═══ Phase 1: Parse document ═══
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('language', activeLanguage);
      formData.append('sourceLang', sourceLanguage);

      const response = await fetch('/api/parse', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();

      // Update store with parsed segments
      setProject(data.projectId, data.projectName);
      setSegments(data.segments.map((s: any) => ({
        ...s,
        originalTarget: s.targetText,
      })));

      // Fetch glossary for the chosen target language
      const glossRes = await fetch(`/api/glossary/${activeLanguage}`);
      if (glossRes.ok) {
        const glossary = await glossRes.json();
        setGlossary(glossary);
      }

      toast.success(`Parsed ${data.segmentCount} segments — starting translation…`, {
        duration: 3000,
        icon: <CheckCircle2 className="w-5 h-5" />,
      });

      // ═══ Navigate IMMEDIATELY — don't wait for translation ═══
      setIsParsing(false);
      setParsePhase('idle');
      navigate('/editor');

      // ═══ Phase 2: Background streaming translation ═══
      const store = useAppStore.getState();
      store.setTranslationProgress(0, data.segments.length, 0);

      fetch('/api/translate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: data.projectId,
          segments: data.segments,
          sourceLang: sourceLanguage,
          targetLang: activeLanguage,
        }),
      }).then(async (streamRes) => {
        if (!streamRes.ok || !streamRes.body) {
          store.clearTranslationProgress();
          return;
        }
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              const s = useAppStore.getState();
              if (event.type === 'segment_done') {
                s.updateSegmentTranslation(event.segmentId, event.translatedText, event.matchType, event.tmScore);
                s.setTranslationProgress(event.current, event.total, 0);
              } else if (event.type === 'segment_error') {
                s.setTranslationProgress(event.current, event.total, (s.translationProgress?.errors || 0) + 1);
              } else if (event.type === 'complete') {
                s.clearTranslationProgress();
                toast.success(`Translation complete: ${event.total} segments`, { duration: 4000, icon: '✅' });
              }
            } catch {}
          }
        }
      }).catch(() => { store.clearTranslationProgress(); });

      return;
    } catch (err: any) {
      toast.error(err.message || 'Failed to parse document', { duration: 5000 });
    } finally {
      setIsParsing(false);
      setParsePhase('idle');
    }
  };

  // Group languages by region for dropdowns
  const allLangs = languages.filter(l => l.region !== 'source');
  const sourceLangs = languages; // Any language can be a source

  return (
    <div className="w-screen h-screen flex overflow-hidden">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: 'var(--font-dm-sans)',
            borderRadius: '12px',
          },
        }}
      />

      {/* Left Sidebar */}
      <div className="w-[260px] bg-brand-indigo flex flex-col">
        <div className="p-6 border-b border-white/10">
          <Link to="/home" className="text-[22px] font-black">
            <span className="text-white">verb</span>
            <span className="text-brand-emerald">AI</span>
          </Link>
        </div>

        <nav className="flex-1 py-6">
          <Link
            to="/upload"
            className="flex items-center gap-3 px-6 py-3 text-label-caps text-white bg-white/8 border-l-[3px] border-brand-emerald"
          >
            UPLOAD
          </Link>
          <Link
            to="/editor"
            className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5"
          >
            TRANSLATION
          </Link>
          <Link
            to="/analytics"
            className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5"
          >
            ANALYTICS
          </Link>
        </nav>

        <div className="p-6 border-t border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-emerald flex items-center justify-center text-white font-bold">
            A
          </div>
          <div className="flex-1">
            <div className="text-body-sm font-medium text-white">Admin</div>
            <div className="text-[11px] text-white/60">Linguist</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-[#FAFAFA] overflow-y-auto overflow-x-hidden relative">
        <div className="flex-1 flex flex-col items-center pt-24 px-8 pb-12 w-full max-w-[800px] mx-auto z-10">
          
          {/* Header & Glowing Orb */}
          <motion.div
            className="text-center mb-10 w-full flex flex-col items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >

            <h1 className="text-[32px] md:text-[40px] font-medium text-brand-indigo tracking-tight leading-tight">
              Good Afternoon, Admin <br/>
              What do you want to <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#d946ef] to-[#c026d3]">translate?</span>
            </h1>
          </motion.div>

          {/* Chat-like Input Card / Dropzone */}
          <motion.div
            className={`w-full bg-white rounded-3xl transition-all duration-300 relative ${
              isDragOver ? 'ring-2 ring-[#d946ef] shadow-[0_0_40px_rgba(217,70,239,0.15)] bg-[#faf5ff]' : 'shadow-[0_2px_18px_rgba(0,0,0,0.04)] ring-1 ring-black/5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]'
            }`}
            style={{ minHeight: '160px' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf"
              className="hidden"
              onChange={handleFileSelect}
            />

            <div className="p-6 pb-2 min-h-[120px] cursor-text" onClick={() => !selectedFile && fileInputRef.current?.click()}>
              <AnimatePresence mode="wait">
                {isParsing ? (
                  <motion.div key="parsing" className="flex items-center gap-4 text-ui-slate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Sparkles className="w-5 h-5 text-[#d946ef] animate-pulse" />
                    <span className="text-[15px] animate-pulse">Running translation pipeline...</span>
                  </motion.div>
                ) : selectedFile ? (
                  <motion.div key="selected" className="flex items-center gap-4 bg-ui-surface p-3 rounded-2xl w-fit pr-10 relative group" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onClick={e => e.stopPropagation()}>
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-brand-indigo">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[14px] font-medium text-brand-indigo truncate max-w-[200px]">{selectedFile.name}</span>
                      <span className="text-[12px] text-ui-slate">{formatFileSize(selectedFile.size)}</span>
                    </div>
                    <button onClick={() => setSelectedFile(null)} className="absolute right-3 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-white rounded-full transition-all">
                      <X className="w-4 h-4 text-ui-slate" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.div key="empty" className="flex items-start gap-4 text-ui-slate/60 hover:text-ui-slate transition-colors" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Sparkles className="w-5 h-5 mt-0.5 text-brand-indigo" />
                    <span className="text-[16px] xl:text-[18px]">
                      {isDragOver ? "Drop your document here..." : "Drop a document here or click to browse"}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Toolbar */}
            <div className="px-3 py-3 border-t border-black/5 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-50/50 rounded-b-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-medium text-brand-indigo hover:bg-gray-50 transition-colors"
                >
                  <Paperclip className="w-4 h-4" />
                  Attach
                </button>
                
                <div className="flex items-center gap-1.5 p-1 rounded-xl border border-black/10 bg-white">
                  <select
                    value={sourceLanguage}
                    onChange={(e) => setSourceLanguage(e.target.value)}
                    className="h-8 px-2 pr-6 rounded-lg bg-transparent text-[13px] font-medium text-brand-indigo outline-none cursor-pointer appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23374151' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
                  >
                    {Object.entries(REGION_LABELS).map(([region, label]) => {
                      const regionLangs = sourceLangs.filter(l => l.region === region);
                      if (regionLangs.length === 0) return null;
                      return (
                        <optgroup key={region} label={label}>
                          {regionLangs.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                  <ArrowRight className="w-3 h-3 text-ui-slate" />
                  <select
                    value={activeLanguage}
                    onChange={(e) => setActiveLanguage(e.target.value)}
                    className="h-8 px-2 pr-6 rounded-lg bg-transparent text-[13px] font-medium text-brand-indigo outline-none cursor-pointer appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23374151' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
                  >
                    {Object.entries(REGION_LABELS).filter(([r]) => r !== 'source').map(([region, label]) => {
                      const regionLangs = allLangs.filter(l => l.region === region);
                      if (regionLangs.length === 0) return null;
                      return (
                        <optgroup key={region} label={label}>
                          {regionLangs.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button 
                  onClick={handleUpload}
                  disabled={!selectedFile || isParsing}
                  className={`flex items-center justify-center w-10 h-10 rounded-full transition-all shadow-sm
                    ${selectedFile && !isParsing 
                      ? 'bg-brand-indigo text-white hover:bg-black hover:scale-105 active:scale-95 cursor-pointer' 
                      : 'bg-black/5 text-black/30 cursor-not-allowed'}`}
                >
                  <ArrowUp className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Example / Features Section */}
          <motion.div
            className="w-full mt-16"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <p className="text-[11px] font-semibold text-ui-slate uppercase tracking-wider mb-5 ml-1">
              GET STARTED WITH THE PLATFORM FEATURES BELOW
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { title: 'Local Privacy', desc: 'Secure local parsing', icon: <Shield className="w-4 h-4 text-brand-indigo" /> },
                { title: 'Document Formats', desc: 'DOCX & PDF formats', icon: <FileOutput className="w-4 h-4 text-brand-indigo" /> },
                { title: '36+ Languages', desc: 'Indian & Global', icon: <Globe className="w-4 h-4 text-brand-indigo" /> },
                { title: 'Smart RAG', desc: 'Translation memory', icon: <Zap className="w-4 h-4 text-brand-indigo" /> },
              ].map((card, i) => (
                <div key={i} className="bg-white rounded-2xl p-4.5 border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:border-black/10 hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-all cursor-pointer flex flex-col h-full">
                  <p className="text-[14px] font-medium text-brand-indigo leading-tight mb-2 flex-grow">{card.title}</p>
                  <p className="text-[12px] text-ui-slate flex-grow">{card.desc}</p>
                  <div className="mt-4 opacity-70">
                    {card.icon}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
