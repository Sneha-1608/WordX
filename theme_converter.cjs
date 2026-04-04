const fs = require('fs');

let css = fs.readFileSync('src/index.css', 'utf-8');

// Update variables
const newRoot = `:root {
  --bg-primary: #f8fafc;
  --bg-secondary: #ffffff;
  --text-primary: #0f172a;
  --text-secondary: #64748b;
  --primary-color: #6366f1;
  --primary-hover: #4f46e5;
  --secondary-color: #8b5cf6;
  --accent-color: #10b981;
  --border-color: rgba(0, 0, 0, 0.1);
  --glass-bg: rgba(255, 255, 255, 0.8);
  --glass-border: rgba(255, 255, 255, 0.5);
  --danger: #ef4444;

  --solid-text: #1e293b;
  --solid-text-invert: #ffffff;
  
  --overlay-bg: rgba(0,0,0,0.05);
  --overlay-hover: rgba(0,0,0,0.1);
  --overlay-dark: #f1f5f9;
  --overlay-glass-dark: rgba(255,255,255,0.7);
}

[data-theme="dark"] {
  --bg-primary: #0a0a0f;
  --bg-secondary: #13131a;
  --text-primary: #ffffff;
  --text-secondary: #9ca3af;
  --border-color: rgba(255, 255, 255, 0.08);
  --glass-bg: rgba(19, 19, 26, 0.6);
  --glass-border: rgba(255, 255, 255, 0.1);
  
  --solid-text: #ffffff;
  --solid-text-invert: #000000;

  --overlay-bg: rgba(255, 255, 255, 0.05);
  --overlay-hover: rgba(255, 255, 255, 0.1);
  --overlay-dark: rgba(0, 0, 0, 0.3);
  --overlay-glass-dark: rgba(0, 0, 0, 0.4);
}`;

// replace :root block
css = css.replace(/:root\s*\{[\s\S]*?--danger:\s*#ef4444;\n\}/, newRoot);

// Bulk text replacements:
css = css.replace(/color:\s*white;/g, 'color: var(--solid-text);');
css = css.replace(/color:\s*#e5e7eb;/g, 'color: var(--text-primary);');
css = css.replace(/color:\s*#d1d5db;/g, 'color: var(--text-primary);');
css = css.replace(/color:\s*black;/g, 'color: var(--solid-text-invert);'); // opposite
css = css.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.05\);/g, 'background: var(--overlay-bg);');
css = css.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.1\);/g, 'background: var(--overlay-hover);');
css = css.replace(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.2\);/g, 'background: var(--overlay-bg);');
css = css.replace(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.3\);/g, 'background: var(--overlay-dark);');
css = css.replace(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.4\);/g, 'background: var(--overlay-glass-dark);');
css = css.replace(/background:\s*white;/g, 'background: var(--solid-text);'); // tooltips now invert 
css = css.replace(/border(.*?)rgba\(255,\s*255,\s*255,\s*0\.0[35]\)/g, 'border$1var(--border-color)');
css = css.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.02\);/g, 'background: var(--overlay-bg);');
css = css.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.03\);/g, 'background: var(--overlay-bg);');


// Navbar adjustments specifically
if (css.includes('.navbar {')) {
  css = css.replace(/background:\s*rgba\(10,\s*10,\s*15,\s*0\.8\);/, 'background: var(--glass-bg);');
}

// Nav links flex adjust
if (css.includes('.nav-links {')) {
  css = css.replace(/\.nav-links\s*\{\s*display:\s*flex;/, '.nav-links {\n  display: flex;\n  margin-right: auto;\n  margin-left: 2rem;');
}

fs.writeFileSync('src/index.css', css);
console.log('CSS conversion complete.');
