import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Loader2, FileText, SpellCheck, Layout, Type } from 'lucide-react';

const verificationSteps = [
  { id: 'punc', label: 'Verifying Punctuation', icon: <Type size={20} /> },
  { id: 'grammar', label: 'Checking Grammar & Syntax', icon: <SpellCheck size={20} /> },
  { id: 'format', label: 'Analyzing Document Formatting', icon: <Layout size={20} /> }
];

const DocumentVerification = ({ onComplete, fileName }) => {
  const [completedSteps, setCompletedSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (currentStepIndex < verificationSteps.length) {
      const timer = setTimeout(() => {
        setCompletedSteps(prev => [...prev, verificationSteps[currentStepIndex].id]);
        setCurrentStepIndex(curr => curr + 1);
      }, 1500);
      return () => clearTimeout(timer);
    } else {
      const finishTimer = setTimeout(() => {
        onComplete();
      }, 800);
      return () => clearTimeout(finishTimer);
    }
  }, [currentStepIndex, onComplete]);

  return (
    <div className="verification-page fade-in">
      <div className="verification-header">
        <div className="file-pill">
          <FileText size={16} />
          <span>{fileName}</span>
        </div>
        <h2 className="verification-title">Document Intelligence Check</h2>
        <p className="verification-desc">We are verifying your document structure before translation.</p>
      </div>

      <div className="verification-list">
        {verificationSteps.map((step, index) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = index === currentStepIndex;

          return (
            <div key={step.id} className={`verification-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'active' : ''}`}>
              <div className="step-icon">
                {isCompleted ? <CheckCircle2 size={22} className="text-primary" /> : step.icon}
              </div>
              <div className="step-info">
                <span className="step-label">{step.label}</span>
                <span className="step-status">
                  {isCompleted ? 'Verified' : isCurrent ? 'Analyzing...' : 'Pending'}
                </span>
              </div>
              {isCurrent && (
                <div className="loading-spinner">
                  <Loader2 size={18} className="spin-icon" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="verification-footer">
        <div className="security-note">
          <AlertCircle size={14} />
          <span>Edge-AI Verification &middot; Privacy Guaranteed</span>
        </div>
      </div>
    </div>
  );
};

export default DocumentVerification;
