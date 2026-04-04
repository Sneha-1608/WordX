import React from 'react';
import './WaveLines.css';

const WaveLines = () => {
  const lineCount = 65; // High density for the 3D typography effect
  
  const lines = Array.from({ length: lineCount }).map((_, i) => {
    const y = -150 + (i * 22);
    
    // Create organic 3D-looking pinches and expands
    const ampY = 120 + Math.sin(i * 0.15) * 50; 
    const phaseX = Math.sin(i * 0.1) * 150;
    
    // Start way off-screen left to ensure full coverage during panning
    const startX = -1200 + phaseX;
    
    return (
      <path
        key={i}
        // q creates the down-wave
        // t repeats an alternating up-wave, down-wave seamlessly
        d={`M ${startX} ${y} 
            q 300 ${ampY}, 600 0 
            t 600 0 
            t 600 0 
            t 600 0 
            t 600 0 
            t 600 0 
            t 600 0`}
        fill="none"
        className={`wave-path ${i % 3 === 0 ? 'thick' : ''} ${i % 4 === 0 ? 'dim' : ''}`}
      />
    );
  });

  return (
    <div className="wave-lines-container">
      <svg
        className="wave-lines-svg"
        viewBox="0 0 1200 1000"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className="wave-group">
          {lines}
        </g>
      </svg>
    </div>
  );
};

export default WaveLines;
