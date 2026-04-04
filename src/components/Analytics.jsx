import React from 'react';
import { BarChart3, FileText, CheckCircle2, Clock, ArrowUpRight, TrendingUp } from 'lucide-react';

const recentFiles = [
  { name: 'Business_Strategy_2024.pdf', date: '2 hours ago', accuracy: '98.5%', status: 'Completed' },
  { name: 'Technical_Spec_v2.docx', date: 'Yesterday', accuracy: '99.2%', status: 'Completed' },
  { name: 'Marketing_Proposal.pdf', date: '3 days ago', accuracy: '97.8%', status: 'Completed' },
];

const Analytics = () => {
  return (
    <div className="analytics-page fade-in">
      <header className="page-header">
        <h1 className="page-title">Performance Analytics</h1>
        <p className="page-desc">Overview of your translation accuracy and history.</p>
      </header>

      <div className="stats-grid">
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{background: 'rgba(16, 185, 129, 0.1)', color: '#10b981'}}>
            <BarChart3 size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Average Accuracy</span>
            <div className="stat-value-group">
              <h3 className="stat-value">98.4%</h3>
              <span className="stat-change positive"><TrendingUp size={12}/> +1.2%</span>
            </div>
          </div>
        </div>

        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{background: 'rgba(52, 211, 153, 0.1)', color: '#34d399'}}>
            <FileText size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Total Documents</span>
            <div className="stat-value-group">
              <h3 className="stat-value">124</h3>
            </div>
          </div>
        </div>

        <div className="stat-card glass-panel">
          <div className="stat-icon-wrap" style={{background: 'rgba(16, 185, 129, 0.1)', color: '#10b981'}}>
            <CheckCircle2 size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Tokens Translated</span>
            <div className="stat-value-group">
              <h3 className="stat-value">4.2M</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="recent-files-section">
        <div className="section-header">
          <h2 className="section-title">Recent Activity</h2>
          <button className="text-btn">View all</button>
        </div>
        
        <div className="files-list">
          {recentFiles.map((file, i) => (
            <div key={i} className="file-item glass-panel">
              <div className="file-main">
                <div className="file-icon-small">
                  <FileText size={20} />
                </div>
                <div className="file-details">
                  <p className="file-name">{file.name}</p>
                  <span className="file-meta"><Clock size={12}/> {file.date}</span>
                </div>
              </div>
              <div className="file-stats">
                <div className="accuracy-pill">
                  {file.accuracy} Accuracy
                </div>
                <button className="icon-button-small">
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Analytics;
