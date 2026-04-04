import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [splitReady, setSplitReady] = useState(false);
  const navigate = useNavigate();
  const counter = useMotionValue(0);
  const displayProgress = useTransform(counter, (v) => Math.round(v));

  useEffect(() => {
    // Non-linear ease: fast start, slow finish
    const controls = animate(counter, 100, {
      duration: 2.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setProgress(Math.round(v)),
      onComplete: () => {
        setSplitReady(true);
        setTimeout(() => navigate('/home'), 800);
      },
    });

    return () => controls.stop();
  }, [counter, navigate]);

  return (
    <div className="w-screen h-screen relative overflow-hidden">
      {/* Top Half */}
      <div
        className={`absolute inset-0 bottom-1/2 bg-brand-indigo z-50 flex flex-col items-center justify-end ${
          splitReady ? 'split-top' : ''
        }`}
      >
        <div className="h-1/2" />
      </div>

      {/* Bottom Half */}
      <div
        className={`absolute inset-0 top-1/2 bg-brand-indigo z-50 flex flex-col items-center justify-start ${
          splitReady ? 'split-bottom' : ''
        }`}
      >
        <div className="h-1/2" />
      </div>

      {/* Main Content (behind the split) */}
      <div className="w-full h-full bg-brand-indigo flex flex-col items-center justify-center relative z-40">
        {/* Animated Bouncing Orb with Physics Spring */}
        <div className="relative h-[240px] w-[120px] flex items-center justify-center mb-12">
          {/* Fading trail positions */}
          <motion.div
            className="w-12 h-12 rounded-full bg-brand-emerald absolute"
            style={{ filter: 'blur(8px)' }}
            animate={{
              y: [80, -80, 80],
              opacity: [0.08, 0.15, 0.08],
              scale: [1.2, 0.8, 1.2],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 0.2,
            }}
          />
          <motion.div
            className="w-12 h-12 rounded-full bg-brand-emerald absolute"
            style={{ filter: 'blur(4px)' }}
            animate={{
              y: [80, -80, 80],
              opacity: [0.1, 0.25, 0.1],
              scale: [1.1, 0.9, 1.1],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 0.1,
            }}
          />
          {/* Primary orb with spring physics */}
          <motion.div
            className="w-12 h-12 rounded-full bg-brand-emerald absolute"
            style={{ boxShadow: '0px 0px 48px rgba(16,185,129,0.4), 0px 0px 96px rgba(16,185,129,0.2)' }}
            animate={{
              y: [80, -80, 80],
              scale: [1.1, 0.95, 1.1],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              type: 'spring',
              stiffness: 100,
              damping: 8,
            }}
          />
          {/* Ground shadow */}
          <motion.div
            className="absolute bottom-0 w-16 h-2 rounded-full bg-brand-emerald"
            style={{ filter: 'blur(6px)' }}
            animate={{
              opacity: [0.3, 0.08, 0.3],
              scaleX: [1, 0.5, 1],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>

        {/* Progress Counter */}
        <motion.div className="text-center mb-6">
          <span
            className="text-white font-black"
            style={{ fontSize: '96px', lineHeight: '100%', letterSpacing: '-2px' }}
          >
            {progress}%
          </span>
        </motion.div>

        {/* Processing Label */}
        <div
          className="text-ui-slate-light mb-32"
          style={{
            fontFamily: 'var(--font-dm-sans)',
            fontWeight: 500,
            fontSize: '13px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          PROCESSING LANGUAGE...
        </div>

        {/* Bottom Quote */}
        <div className="absolute bottom-16 left-0 right-0 text-center">
          <motion.p
            className="text-body-sm italic max-w-[560px] mx-auto px-8"
            style={{ color: 'rgba(255,255,255,0.5)' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
          >
            You've landed on an AI translation platform. Prepare to rethink how language works.
          </motion.p>
        </div>
      </div>
    </div>
  );
}
