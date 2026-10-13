import { searchWithCodex } from '../lib/codex.js';
import { searchPreferences } from '../lib/discovery.js';
import { writeFile, mkdir } from 'node:fs/promises';
const result = await searchWithCodex(searchPreferences({ domains: 'Data engineering', location: 'Morocco', level: 'Any experience level', maxAgeDays: 7 }));
await mkdir('test-results', { recursive: true });
await writeFile('test-results/search-smoke.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ jobs: result.jobs.map(j => ({ title: j.title, company: j.company, url: j.url, verification: j.verification, descriptionCharacters: j.description.length })), summary: result.summary }));
