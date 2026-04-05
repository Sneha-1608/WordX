import fs from 'fs';
import path from 'path';

function walk(dir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') walk(fullPath);
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.md')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('gemini-2.0-flash')) {
        fs.writeFileSync(fullPath, content.replace(/gemini-2.0-flash/g, 'gemini-1.5-flash'), 'utf8');
        console.log('Fixed:', fullPath);
      }
    }
  });
}

walk(path.join(process.cwd(), 'server'));
