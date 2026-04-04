import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, FileText, X, AlertCircle, CheckCircle2, ArrowRight, Globe } from 'lucide-react';
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

  const SUPPORTED_FORMATS = new Set(['docx', 'pdf', 'txt', 'xlsx', 'xls', 'csv', 'pptx', 'html', 'htm', 'rtf', 'md']);

  const validateFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_FORMATS.has(ext)) {
      toast.error(`Unsupported format: .${ext}. We accept DOCX, PDF, TXT, XLSX, CSV, PPTX, HTML, and more.`, {
        duration: 4000,
        icon: <AlertCircle className="w-5 h-5" />,
      });
      return false;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 50MB.', { duration: 4000 });
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

      toast.success(`Parsed ${data.segmentCount} segments from "${data.projectName}"`, {
        duration: 3000,
        icon: <CheckCircle2 className="w-5 h-5" />,
      });

      // ═══ Phase 2: Translate via RAG pipeline ═══
      setParsePhase('translating');

      try {
        const translateRes = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: data.projectId,
            segments: data.segments,
            sourceLang: sourceLanguage,
            targetLang: activeLanguage,
          }),
        });

        if (translateRes.ok) {
          const translated = await translateRes.json();
          setSegments(translated.segments.map((s: any) => ({
            ...s,
            originalTarget: s.targetText,
          })));

          const stats = translated.stats;
          toast.success(
            `Translation complete: ${stats.exact} exact, ${stats.fuzzy} fuzzy, ${stats.new} new (${stats.leverageRate}% TM leverage)`,
            { duration: 4000 }
          );
        }
      } catch (translateErr) {
        console.warn('Translation pipeline error:', translateErr);
        toast.warning('Translation skipped — segments will need manual translation', { duration: 4000 });
      }

      // Navigate to validation
      setTimeout(() => navigate('/validation'), 800);
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
            <span className="text-white">Clear</span>
            <span className="text-brand-emerald">Lingo</span>
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
      <div className="flex-1 flex flex-col bg-ui-surface overflow-y-auto">
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            className="w-full max-w-[720px]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="text-center mb-8">
              <h1 className="text-display-h3 text-brand-indigo mb-3">Upload Document</h1>
              <p className="text-body-lg text-ui-slate">
                Drop any document file to begin translation
              </p>
            </div>

            {/* Language Selector Row */}
            <motion.div
              className="flex items-center justify-center gap-4 mb-8"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              {/* Source Language */}
              <div className="flex flex-col items-start">
                <label className="text-[11px] font-semibold text-ui-slate uppercase tracking-wider mb-1.5 ml-1">
                  From
                </label>
                <select
                  id="source-language-select"
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  className="h-11 px-4 pr-8 rounded-xl bg-ui-white border border-ui-border text-body-md text-brand-indigo font-medium
                             hover:border-brand-emerald/50 focus:border-brand-emerald focus:ring-2 focus:ring-brand-emerald/20
                             outline-none transition-all cursor-pointer appearance-none min-w-[180px]"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                  }}
                >
                  {Object.entries(REGION_LABELS).map(([region, label]) => {
                    const regionLangs = sourceLangs.filter(l => l.region === region);
                    if (regionLangs.length === 0) return null;
                    return (
                      <optgroup key={region} label={label}>
                        {regionLangs.map(l => (
                          <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-brand-indigo/10 mt-5">
                <ArrowRight className="w-5 h-5 text-brand-indigo" />
              </div>

              {/* Target Language */}
              <div className="flex flex-col items-start">
                <label className="text-[11px] font-semibold text-ui-slate uppercase tracking-wider mb-1.5 ml-1">
                  To
                </label>
                <select
                  id="target-language-select"
                  value={activeLanguage}
                  onChange={(e) => setActiveLanguage(e.target.value)}
                  className="h-11 px-4 pr-8 rounded-xl bg-ui-white border border-ui-border text-body-md text-brand-indigo font-medium
                             hover:border-brand-emerald/50 focus:border-brand-emerald focus:ring-2 focus:ring-brand-emerald/20
                             outline-none transition-all cursor-pointer appearance-none min-w-[180px]"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                  }}
                >
                  {Object.entries(REGION_LABELS).filter(([r]) => r !== 'source').map(([region, label]) => {
                    const regionLangs = allLangs.filter(l => l.region === region);
                    if (regionLangs.length === 0) return null;
                    return (
                      <optgroup key={region} label={label}>
                        {regionLangs.map(l => (
                          <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
            </motion.div>

            {/* Dropzone */}
            <motion.div
              className={`relative rounded-[24px] border-2 border-dashed p-12 transition-all duration-300 cursor-pointer ${
                isDragOver
                  ? 'border-brand-emerald bg-brand-emerald-light/50 scale-[1.02]'
                  : selectedFile
                  ? 'border-brand-emerald bg-brand-emerald-light/20'
                  : 'border-ui-border bg-ui-white hover:border-brand-emerald/50 hover:bg-ui-surface'
              }`}
              style={{ boxShadow: 'var(--shadow-md)' }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !selectedFile && fileInputRef.current?.click()}
              whileHover={!selectedFile ? { scale: 1.01 } : {}}
              whileTap={!selectedFile ? { scale: 0.99 } : {}}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,.txt,.xlsx,.xls,.csv,.pptx,.html,.htm,.rtf,.md"
                className="hidden"
                onChange={handleFileSelect}
              />

              <AnimatePresence mode="wait">
                {isParsing ? (
                  <motion.div
                    key="parsing"
                    className="flex flex-col items-center gap-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {/* Skeleton Loader */}
                    <div className="w-full space-y-3">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className="flex items-center gap-4">
                          <div
                            className="h-3 rounded-full bg-gradient-to-r from-ui-border via-ui-surface to-ui-border skeleton-shimmer"
                            style={{ width: `${40 + Math.random() * 40}%`, animationDelay: `${i * 0.12}s` }}
                          />
                          <div className="w-px h-4 bg-ui-border" />
                          <div
                            className="h-3 rounded-full bg-gradient-to-r from-ui-border via-ui-surface to-ui-border skeleton-shimmer"
                            style={{ width: `${30 + Math.random() * 30}%`, animationDelay: `${i * 0.12 + 0.06}s` }}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-body-sm text-ui-slate animate-pulse">
                      {parsePhase === 'translating'
                        ? 'Running RAG translation pipeline (TM lookup → Gemini → glossary)...'
                        : 'Parsing document and building segments...'}
                    </p>
                  </motion.div>
                ) : selectedFile ? (
                  <motion.div
                    key="selected"
                    className="flex flex-col items-center gap-4"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-brand-emerald-light flex items-center justify-center">
                      <FileText className="w-8 h-8 text-brand-emerald" />
                    </div>
                    <div className="text-center">
                      <p className="text-body-md font-semibold text-brand-indigo">{selectedFile.name}</p>
                      <p className="text-body-sm text-ui-slate">{formatFileSize(selectedFile.size)}</p>
                      <p className="text-body-sm text-ui-slate mt-1">
                        {getLangName(sourceLanguage)} → {getLangName(activeLanguage)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      className="absolute top-4 right-4 w-8 h-8 rounded-full bg-ui-surface flex items-center justify-center hover:bg-ui-border transition-colors"
                    >
                      <X className="w-4 h-4 text-ui-slate" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    className="flex flex-col items-center gap-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <motion.div
                      className="w-16 h-16 rounded-2xl bg-ui-surface flex items-center justify-center"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <Upload className="w-8 h-8 text-ui-slate" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-body-md font-semibold text-brand-indigo">
                        Drag & drop your document here
                      </p>
                      <p className="text-body-sm text-ui-slate mt-1">or click to browse</p>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-ui-surface">
                      <FileText className="w-4 h-4 text-ui-slate" />
                      <span className="text-code-sm text-ui-slate">DOCX · PDF · TXT · XLSX · CSV · PPTX · HTML</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Upload Button */}
            <AnimatePresence>
              {selectedFile && !isParsing && (
                <motion.div
                  className="flex justify-center mt-8"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  <Button variant="primary" size="lg" onClick={handleUpload}>
                    Parse & Begin Translation
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Info Footer */}
            <div className="mt-12 flex items-center justify-center gap-6">
              {[
                { icon: '🔒', text: 'Files parsed locally' },
                { icon: '📄', text: '10+ file formats' },
                { icon: '🌐', text: '36+ languages' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-body-sm text-ui-slate">
                  <span>{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
