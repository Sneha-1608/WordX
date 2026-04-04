import { Link } from 'react-router';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './Button';
import { Menu, X } from 'lucide-react';

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 60);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const navLinks = [
    { name: 'HOW IT WORKS', href: '#process' },
    { name: 'LANGUAGES', href: '#languages' },
    { name: 'RESEARCH', href: '#research' },
    { name: 'CONTACT', href: '#contact' },
  ];

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? 'bg-white/85 backdrop-blur-[12px] shadow-[0px_2px_8px_rgba(0,0,0,0.04)]'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px] h-[72px] flex items-center justify-between">
          {/* Logo */}
          <Link to="/home" className="flex items-center relative z-50">
            <span className="text-[22px] font-black">
              <span className="text-brand-indigo">Verb</span>
              <span className="text-brand-emerald"> AI</span>
            </span>
          </Link>

          {/* Center Navigation — Desktop */}
          <div className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="text-label-caps text-ui-slate hover:text-brand-indigo transition-colors duration-200 relative group"
              >
                {link.name}
                <span className="absolute bottom-[-4px] left-0 w-0 h-[2px] bg-brand-emerald transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </div>



          {/* Hamburger — Mobile */}
          <button
            className="lg:hidden relative z-50 w-10 h-10 flex items-center justify-center"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="w-6 h-6 text-white" />
            ) : (
              <Menu className={`w-6 h-6 ${isScrolled ? 'text-brand-indigo' : 'text-brand-indigo'}`} />
            )}
          </button>
        </div>
      </nav>

      {/* Full-screen Mobile Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-brand-indigo flex flex-col items-center justify-center gap-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {navLinks.map((link, i) => (
              <motion.a
                key={link.name}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-white font-black text-center"
                style={{ fontSize: '48px', lineHeight: '120%' }}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                {link.name.toLowerCase()}
              </motion.a>
            ))}


          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}