import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, FileText, CheckCircle2, Clock, ArrowUpRight, TrendingUp,
  Database, RefreshCw, Globe, Zap, DollarSign, Activity
} from 'lucide-react';

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/dashboard');
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const d = await res.json();
      setData(d);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchAnalytics, 30000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  if (loading) return (
    <div className="analytics-page fade-in">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '1rem' }}>
        <RefreshCw size={32} className="spin-icon text-primary" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading live analytics...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="analytics-page fade-in">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '1rem', textAlign: 'center' }}>
        <Activity size={32} style={{ color: 'var(--danger)' }} />
        <p style={{ color: 'var(--danger)' }}>Failed to load analytics: {error}</p>
        <button className="text-btn" onClick={fetchAnalytics}>Retry</button>
      </div>
    </div>
  );

  const lev = data?.leverage || {};
  const tmGrowth = data?.tmGrowth || {};
  const comp = data?.compliance || {};
  const cost = data?.cost || {};
  const velocity = data?.velocity || {};
  const langCov = data?.languageCoverage || {};
  const recentApprovals = data?.recentApprovals || [];
  const projects = data?.projects || [];

  return (
    <div className="analytics-page fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Performance Analytics</h1>
          <p className="page-desc">Live translation memory stats, accuracy &amp; project history.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={12} style={{ color: '#10b981' }} />
              Live · {lastUpdated}
            </span>
          )}
          <button className="icon-button-small" onClick={fetchAnalytics} title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {/* Stat Cards */}
      <div className="stats-grid">
        {/* TM Leverage */}
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
            <BarChart3 size={26} />
          </div>
          <div className="stat-info">
            <span className="stat-label">TM Leverage Rate</span>
            <div className="stat-value-group">
              <h3 className="stat-value">
                {lev.leverageRate !== undefined ? `${lev.leverageRate}%` : '—'}
              </h3>
              {lev.trend !== undefined && (
                <span className={`stat-change ${lev.trend >= 0 ? 'positive' : 'negative'}`}>
                  <TrendingUp size={12} />
                  {lev.trend >= 0 ? '+' : ''}{lev.trend}%
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              Target: {lev.target || 94}% · {lev.totalSegments || 0} segments
            </div>
          </div>
        </div>

        {/* TM Records */}
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
            <Database size={26} />
          </div>
          <div className="stat-info">
            <span className="stat-label">TM Records</span>
            <div className="stat-value-group">
              <h3 className="stat-value">
                {tmGrowth.totalRecords !== undefined ? tmGrowth.totalRecords.toLocaleString() : '—'}
              </h3>
              {tmGrowth.milestone && (
                <span className="stat-change positive">{tmGrowth.milestone}</span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              Exact: {lev.exactCount ?? 0} · Fuzzy: {lev.fuzzyCount ?? 0} · New: {lev.newCount ?? 0}
            </div>
          </div>
        </div>

        {/* Glossary Compliance */}
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
            <CheckCircle2 size={26} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Glossary Compliance</span>
            <div className="stat-value-group">
              <h3 className="stat-value">
                {comp.complianceRate !== undefined ? `${comp.complianceRate}%` : '—'}
              </h3>
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              {comp.glossaryTerms || 0} terms · {comp.mandatoryTerms || 0} mandatory
            </div>
          </div>
        </div>

        {/* Cost Savings */}
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}>
            <DollarSign size={26} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Cost Savings</span>
            <div className="stat-value-group">
              <h3 className="stat-value">
                {cost.reductionPercent !== undefined ? `${cost.reductionPercent}%` : '—'}
              </h3>
              {cost.savings !== undefined && (
                <span className="stat-change positive">₹{(cost.savings || 0).toLocaleString()}</span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              Manual: ₹{(cost.manualCost || 0).toLocaleString()} → Actual: ₹{(cost.actualCost || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Segments Velocity */}
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>
            <Zap size={26} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Segments Processed</span>
            <div className="stat-value-group">
              <h3 className="stat-value">
                {velocity.allTime !== undefined ? velocity.allTime.toLocaleString() : '—'}
              </h3>
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              Today: {velocity.today ?? 0} · This week: {velocity.thisWeek ?? 0}
            </div>
          </div>
        </div>

        {/* Language Coverage */}
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>
            <Globe size={26} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Language Coverage</span>
            <div className="stat-value-group">
              <h3 className="stat-value">
                {langCov.activeLanguages !== undefined ? langCov.activeLanguages : '—'}
                <span style={{ fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  /{langCov.totalLanguages || 22}
                </span>
              </h3>
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              {langCov.coveragePercent || 0}% coverage · Indian languages
            </div>
          </div>
        </div>
      </div>

      {/* Language Coverage Heatmap */}
      {langCov.languages && langCov.languages.length > 0 && (
        <div className="recent-files-section" style={{ marginBottom: '2rem' }}>
          <div className="section-header" style={{ marginBottom: '1.5rem' }}>
            <h2 className="section-title">Language Coverage Map</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {langCov.languages.map(lang => (
              <div
                key={lang.code}
                title={`${lang.name} (${lang.script}) — ${lang.tmRecords} TM records`}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '100px',
                  border: '1px solid',
                  borderColor: lang.active ? 'rgba(16,185,129,0.5)' : 'var(--border-color)',
                  background: lang.active
                    ? `rgba(16,185,129,${0.08 + lang.intensity * 0.25})`
                    : 'var(--overlay-bg)',
                  color: lang.active ? '#10b981' : 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                  cursor: 'default',
                }}
              >
                {lang.name}
                {lang.active && (
                  <span style={{ marginLeft: '6px', fontSize: '0.7rem', opacity: 0.8 }}>
                    {lang.tmRecords}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects Overview */}
      {projects.length > 0 && (
        <div className="recent-files-section" style={{ marginBottom: '2rem' }}>
          <div className="section-header">
            <h2 className="section-title">Recent Projects</h2>
          </div>
          <div className="files-list">
            {projects.map((proj, i) => (
              <div key={proj.id || i} className="file-item glass-panel">
                <div className="file-main">
                  <div className="file-icon-small">
                    <FileText size={22} />
                  </div>
                  <div className="file-details">
                    <p className="file-name">{proj.name || `Project #${proj.id}`}</p>
                    <span className="file-meta">
                      <Clock size={12} />
                      {proj.sourceLangName || proj.sourceLang} → {proj.targetLangName || proj.targetLang}
                    </span>
                  </div>
                </div>
                <div className="file-stats">
                  <div className="accuracy-pill">
                    {proj.leverageRate}% Leverage
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {proj.approved}/{proj.totalSegments} approved
                  </div>
                  <span style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '100px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    background: proj.status === 'completed' ? 'rgba(16,185,129,0.12)' : 'rgba(249,115,22,0.12)',
                    color: proj.status === 'completed' ? '#10b981' : '#f97316',
                  }}>
                    {proj.status === 'completed' ? 'Done' : 'Active'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Approvals */}
      {recentApprovals.length > 0 && (
        <div className="recent-files-section">
          <div className="section-header">
            <h2 className="section-title">Recent Approvals</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {recentApprovals.slice(0, 8).map((a, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.5rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                gap: '1rem',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--solid-text)', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.segment || 'Segment ' + a.segmentId}
                  </p>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {a.language} · {a.reviewer} · {a.timeAgo || 'Recently'}
                  </span>
                </div>
                <span style={{
                  padding: '0.25rem 0.75rem',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  background: a.matchType === 'EXACT' ? 'rgba(16,185,129,0.12)' : a.matchType === 'FUZZY' ? 'rgba(59,130,246,0.12)' : 'rgba(249,115,22,0.12)',
                  color: a.matchType === 'EXACT' ? '#10b981' : a.matchType === 'FUZZY' ? '#3b82f6' : '#f97316',
                }}>
                  {a.matchType || 'NEW'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!lev.totalSegments && !tmGrowth.totalRecords && !projects.length && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
          <Database size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
          <p style={{ fontSize: '1.1rem' }}>No analytics data yet. Start translating to see live metrics!</p>
        </div>
      )}
    </div>
  );
};

export default Analytics;
