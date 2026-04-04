import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function processFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content
    .replace(/ClearLingo/g, 'VerbAI')
    .replace(/clearlingo/g, 'verbai')
    .replace(/CLEARLINGO/g, 'VERBAI');
    
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('Updated: ' + filePath);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!['node_modules', '.git', 'dist', '.next'].includes(file)) {
        walk(fullPath);
      }
    } else {
      if (fullPath.match(/\.(js|jsx|ts|tsx|css|md|json|py)$/)) {
        processFile(fullPath);
      }
    }
  }
}

walk(path.join(__dirname, 'src'));
walk(path.join(__dirname, 'server'));
walk(path.join(__dirname, 'scripts'));

const rootFiles = [
  'package.json', 
  'README.md', 
  'check.js', 
  'seed_tm.js', 
  'seed_tm_v2.js', 
  'download_datasets.py', 
  'download_flores.py', 
  'PROJECT_SUMMARY.md', 
  'implementation_plan.md', 
  'ClearLingo_Improvements_Prompt.md'
];

for (const f of rootFiles) {
  processFile(path.join(__dirname, f));
}
