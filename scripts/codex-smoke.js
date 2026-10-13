import { rankWithCodex, codexStatus } from '../lib/codex.js';
const status = await codexStatus();
console.log(JSON.stringify(status));
if (!status.ready) process.exit(1);
const result = await rankWithCodex({
  resume: 'Synthetic test candidate: Software engineer with three years building React and TypeScript applications, REST APIs, SQL queries and accessible user interfaces. No Kubernetes experience.',
  jobs: [{ id: 'synthetic-react', title: 'Frontend engineer', company: 'Synthetic example company', location: 'Remote', url: '', description: 'Build accessible user interfaces with React and TypeScript. Three years of frontend experience and familiarity with REST APIs required. SQL experience is helpful. Kubernetes is optional.' }],
  researchContacts: false
});
console.log(JSON.stringify({ valid: result.rankings.length === 1, score: result.rankings[0].score, jobId: result.rankings[0].jobId, summary: result.summary }));
