import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
if (!html.includes('href="#codex"')) writeFileSync('public/index.html', html.replace('</nav>', '<a href="#codex" data-page="codex">↗ <span>CV & Codex ranking</span></a></nav>'));
