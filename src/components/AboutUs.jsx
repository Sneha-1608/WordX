import React, { useState, useEffect } from 'react';
import {
  Upload, Cpu, CheckCircle2, Download, Globe, Zap, Shield,
  Database, Mail, ExternalLink, Languages,
  BookOpen, Users, ArrowRight, Star, MessageCircle, Phone, Link2
} from 'lucide-react';

const STEPS = [
  {
    icon: Upload,
    step: '01',
    title: 'Upload Your Document',
    desc: 'Drag and drop any PDF, DOCX, or TXT file. Our parser preserves original formatting, tables, headers, and styles while extracting clean text segments.',
    color: '#10b981',
  },
  {
    icon: Database,
    step: '02',
    title: 'Translation Memory Lookup',
    desc: 'Every segment is matched against our curated Translation Memory (TM) database using exact and fuzzy matching — instantly reusing prior approved translations.',
    color: '#3b82f6',
  },
  {
    icon: Cpu,
    step: '03',
    title: 'AI-Powered Translation',
    desc: 'New segments flow through our multi-model AI pipeline — IndicTrans2 for Indian languages, Sarvam AI as fallback, and Gemini for European languages.',
    color: '#8b5cf6',
  },
  {
    icon: CheckCircle2,
    step: '04',
    title: 'Human Approval',
    desc: 'Linguists review each translated segment side-by-side with the original. They can edit in-place before approving — all changes are saved back to TM.',
    color: '#f59e0b',
  },
  {
    icon: Download,
    step: '05',
    title: 'Export & Sync',
    desc: 'Download the fully translated document in DOCX with original formatting intact. Every approved segment is permanently stored in your Translation Memory.',
    color: '#10b981',
  },
];

const FEATURES = [
  { icon: Zap, title: 'Lightning Fast', desc: 'Stream-translated in real-time with live progress updates. No waiting for batch jobs.' },
  { icon: Shield, title: 'Secure & Private', desc: 'All documents are processed locally in your environment. No data leaves your servers.' },
  { icon: Database, title: 'Growing TM', desc: 'Each approved translation grows your private Translation Memory for future leverage.' },
  { icon: Globe, title: '40+ Languages', desc: 'All 22 Indian scheduled languages plus major European and Asian languages.' },
  { icon: BookOpen, title: 'Glossary Compliance', desc: 'Domain-specific terminology is enforced automatically across all translations.' },
  { icon: Users, title: 'Team Collaboration', desc: 'Real-time collaborative review with segment locking and presence indicators.' },
];

const INDIC_LANGS = [
  { name: 'Hindi', script: 'हिन्दी', flag: '🇮🇳' },
  { name: 'Tamil', script: 'தமிழ்', flag: '🇮🇳' },
  { name: 'Telugu', script: 'తెలుగు', flag: '🇮🇳' },
  { name: 'Bengali', script: 'বাংলা', flag: '🇮🇳' },
  { name: 'Marathi', script: 'मराठी', flag: '🇮🇳' },
  { name: 'Gujarati', script: 'ગુજરાતી', flag: '🇮🇳' },
  { name: 'Kannada', script: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { name: 'Malayalam', script: 'മലയാളം', flag: '🇮🇳' },
  { name: 'Punjabi', script: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { name: 'Odia', script: 'ଓଡ଼ିଆ', flag: '🇮🇳' },
  { name: 'Urdu', script: 'اردو', flag: '🇵🇰' },
  { name: 'Nepali', script: 'नेपाली', flag: '🇳🇵' },
];

const INTL_LANGS = [
  { name: 'Spanish', flag: '🇪🇸' },
  { name: 'French', flag: '🇫🇷' },
  { name: 'German', flag: '🇩🇪' },
  { name: 'Japanese', flag: '🇯🇵' },
  { name: 'Chinese', flag: '🇨🇳' },
  { name: 'Korean', flag: '🇰🇷' },
  { name: 'Arabic', flag: '🇸🇦' },
  { name: 'Russian', flag: '🇷🇺' },
  { name: 'Portuguese', flag: '🇧🇷' },
  { name: 'Italian', flag: '🇮🇹' },
];

const STATS_LIVE = [
  { label: 'Translations Delivered', endpoint: '/api/analytics/dashboard', key: 'velocity.allTime', suffix: '+', fallback: '—' },
  { label: 'Languages Supported', endpoint: '/api/analytics/dashboard', key: 'languageCoverage.activeLanguages', suffix: '', fallback: '—' },
  { label: 'TM Match Rate', endpoint: '/api/analytics/dashboard', key: 'leverage.leverageRate', suffix: '%', fallback: '—' },
  { label: 'Glossary Terms', endpoint: '/api/analytics/dashboard', key: 'compliance.glossaryTerms', suffix: '', fallback: '—' },
];

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

const AboutUs = () => {
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [liveStats, setLiveStats] = useState({});
  const [msgSent, setMsgSent] = useState(false);

  useEffect(() => {
    fetch('/api/analytics/dashboard')
      .then(r => r.json())
      .then(d => setLiveStats(d))
      .catch(() => {});
  }, []);

  const handleContact = (e) => {
    e.preventDefault();
    setMsgSent(true);
    setContactForm({ name: '', email: '', message: '' });
    setTimeout(() => setMsgSent(false), 4000);
  };

  return (
    <div className="about-page fade-in">

      {/* Hero Section */}
      <section className="about-hero">
        <div className="about-hero-badge">
          <Star size={14} />
          AI-Powered · Human-Approved · Enterprise Ready
        </div>
        <h1 className="about-hero-title">
          Translation That Thinks,<br />
          <span className="about-hero-highlight">Learns &amp; Remembers.</span>
        </h1>
        <p className="about-hero-sub">
          Verb AI combines cutting-edge neural translation with a growing Translation Memory,
          so every document you translate makes the next one faster, cheaper, and more accurate.
        </p>
        <div className="about-slogans">
          <span className="about-slogan-pill">🧠 Neural + Memory</span>
          <span className="about-slogan-pill">🇮🇳 22 Indian Languages</span>
          <span className="about-slogan-pill">⚡ Real-Time Streaming</span>
          <span className="about-slogan-pill">🔒 Privacy First</span>
        </div>
      </section>

      {/* Live Stats Bar */}
      <section className="about-stats-bar">
        {STATS_LIVE.map((s, i) => {
          let value = s.value;
          if (s.endpoint && s.key) {
            const raw = getNestedValue(liveStats, s.key);
            value = raw !== undefined ? `${raw.toLocaleString()}${s.suffix}` : s.fallback;
          }
          return (
            <div key={i} className="about-stat-item">
              <span className="about-stat-value">{value}</span>
              <span className="about-stat-label">{s.label}</span>
            </div>
          );
        })}
      </section>

      {/* How It Works */}
      <section className="about-section">
        <div className="about-section-header">
          <span className="about-section-badge">HOW IT WORKS</span>
          <h2 className="about-section-title">Five Steps from Upload to Delivery</h2>
          <p className="about-section-desc">
            Our pipeline blends speed, memory, and human judgment — delivering translations that grow smarter with each use.
          </p>
        </div>

        <div className="about-steps">
          {STEPS.map((step, i) => (
            <div key={i} className="about-step-card" style={{ animationDelay: `${i * 0.1}s` }}>
              <div className="about-step-number" style={{ color: step.color }}>{step.step}</div>
              <div className="about-step-icon" style={{ background: `${step.color}18`, color: step.color }}>
                <step.icon size={28} />
              </div>
              <div className="about-step-content">
                <h3 className="about-step-title">{step.title}</h3>
                <p className="about-step-desc">{step.desc}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="about-step-connector">
                  <ArrowRight size={18} style={{ color: 'var(--border-color)' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="about-section">
        <div className="about-section-header">
          <span className="about-section-badge">CAPABILITIES</span>
          <h2 className="about-section-title">Built for Enterprise Translation</h2>
        </div>
        <div className="about-features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="about-feature-card" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="about-feature-icon">
                <f.icon size={24} />
              </div>
              <h3 className="about-feature-title">{f.title}</h3>
              <p className="about-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Languages Section */}
      <section className="about-section">
        <div className="about-section-header">
          <span className="about-section-badge">LANGUAGES</span>
          <h2 className="about-section-title">Every Language, Every Script</h2>
          <p className="about-section-desc">
            Powered by IndicTrans2, Sarvam AI, and Gemini — covering all constitutionally recognized Indian languages plus major global languages.
          </p>
        </div>

        <div className="about-lang-section-row">
          <div className="about-lang-block">
            <div className="about-lang-block-header">
              <Languages size={18} style={{ color: '#10b981' }} />
              <span>Indian Languages (22 Scheduled)</span>
            </div>
            <div className="about-lang-grid">
              {INDIC_LANGS.map((l, i) => (
                <div key={i} className="about-lang-card indic">
                  <span className="about-lang-flag">{l.flag}</span>
                  <div>
                    <div className="about-lang-name">{l.name}</div>
                    <div className="about-lang-native">{l.script}</div>
                  </div>
                </div>
              ))}
              <div className="about-lang-card indic more-card">
                <span style={{ fontSize: '1.5rem' }}>+10</span>
                <div className="about-lang-name">More</div>
              </div>
            </div>
          </div>

          <div className="about-lang-block">
            <div className="about-lang-block-header">
              <Globe size={18} style={{ color: '#3b82f6' }} />
              <span>International Languages</span>
            </div>
            <div className="about-lang-grid">
              {INTL_LANGS.map((l, i) => (
                <div key={i} className="about-lang-card intl">
                  <span className="about-lang-flag">{l.flag}</span>
                  <div className="about-lang-name">{l.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Mission / Brand Slogan */}
      <section className="about-mission">
        <div className="about-mission-inner">
          <blockquote className="about-quote">
            "Language should never be a barrier to knowledge, opportunity, or connection."
          </blockquote>
          <p className="about-mission-text">
            Verb AI was built to democratize access to high-quality translation — making it instant, affordable,
            and continuously improving through the power of human feedback and AI learning.
          </p>
          <div className="about-mission-tags">
            <span>🌍 Break Barriers</span>
            <span>🤝 Human + AI</span>
            <span>📈 Always Learning</span>
            <span>💡 Open &amp; Transparent</span>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="about-section">
        <div className="about-section-header">
          <span className="about-section-badge">CONTACT US</span>
          <h2 className="about-section-title">Get in Touch</h2>
          <p className="about-section-desc">Have questions, feedback, or want to collaborate? We'd love to hear from you.</p>
        </div>

        <div className="about-contact-grid">
          <div className="about-contact-info">
            <div className="about-contact-item">
              <Mail size={20} style={{ color: '#10b981' }} />
              <div>
                <div className="about-contact-label">Email</div>
                <a href="mailto:hello@verbai.dev" className="about-contact-value">hello@verbai.dev</a>
              </div>
            </div>
            <div className="about-contact-item">
              <MessageCircle size={20} style={{ color: '#3b82f6' }} />
              <div>
                <div className="about-contact-label">GitHub Discussions</div>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="about-contact-value">
                  github.com/verbai
                </a>
              </div>
            </div>
            <div className="about-contact-item">
              <Phone size={20} style={{ color: '#8b5cf6' }} />
              <div>
                <div className="about-contact-label">For Enterprise Inquiries</div>
                <span className="about-contact-value">enterprise@verbai.dev</span>
              </div>
            </div>

            <div className="about-social-links">
              <a href="https://github.com/verbai" className="about-social-btn" aria-label="GitHub">
                <ExternalLink size={20} />
              </a>
              <a href="https://twitter.com/verbai" className="about-social-btn" aria-label="Twitter">
                <Link2 size={20} />
              </a>
              <a href="https://linkedin.com/company/verbai" className="about-social-btn" aria-label="LinkedIn">
                <ExternalLink size={20} />
              </a>
            </div>
          </div>

          <form className="about-contact-form" onSubmit={handleContact}>
            {msgSent && (
              <div className="about-success-msg">
                <CheckCircle2 size={20} />
                <span>Message sent! We'll get back to you soon.</span>
              </div>
            )}
            <div className="about-form-row">
              <div className="about-form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={contactForm.name}
                  onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>
              <div className="about-form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="jane@example.com"
                  value={contactForm.email}
                  onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="about-form-group">
              <label>Message</label>
              <textarea
                placeholder="Tell us how we can help..."
                rows={5}
                value={contactForm.message}
                onChange={e => setContactForm(p => ({ ...p, message: e.target.value }))}
                required
              />
            </div>
            <button type="submit" className="finalize-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
              Send Message <ArrowRight size={18} />
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="about-footer">
        <div className="about-footer-inner">
          <div className="about-footer-brand">
            <div className="logo">
              <div className="logo-icon">V</div>
              <span className="logo-text">Verb AI</span>
            </div>
            <p className="about-footer-tagline">
              Neural translation with human precision.<br />
              Built for India. Ready for the world.
            </p>
          </div>
          <div className="about-footer-links">
            <div className="about-footer-col">
              <span className="about-footer-col-title">Product</span>
              <span>Translation Memory</span>
              <span>Glossary Engine</span>
              <span>Human Approval</span>
              <span>Analytics</span>
            </div>
            <div className="about-footer-col">
              <span className="about-footer-col-title">Languages</span>
              <span>Indian Languages</span>
              <span>European Languages</span>
              <span>Asian Languages</span>
              <span>Middle Eastern</span>
            </div>
            <div className="about-footer-col">
              <span className="about-footer-col-title">Company</span>
              <span>About Us</span>
              <span>Privacy Policy</span>
              <span>Terms of Service</span>
              <span>Contact</span>
            </div>
          </div>
        </div>
        <div className="about-footer-bottom">
          <span>© 2026 Verb AI. All rights reserved.</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Built with <span style={{ color: '#ef4444' }}>♥</span> for India's 1.4B people
          </span>
        </div>
      </footer>
    </div>
  );
};

export default AboutUs;
