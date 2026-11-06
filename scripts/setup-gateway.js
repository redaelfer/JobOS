import { join } from 'node:path';
import { credentialStore } from '../lib/ai-config.js';
import { setupGateway, assertJobOSIdle, projectRoot, gatewayWorkspace } from '../lib/gateway.js';
try {
  await assertJobOSIdle();
  const credentials = credentialStore(join(projectRoot, 'data/ai-credentials.json'));
  const result = await setupGateway(credentials, phase => console.log(phase));
  console.log(`FreeLLMAPI ready at ${result.url}. Local default: ${result.model}.`);
  console.log('Dashboard credentials are in ' + join(gatewayWorkspace(), 'data/gateway/private.json') + '. Open that file privately; do not paste it into chat.');
  console.log('Start coding tools with npm run gateway:codex or npm run gateway:claude. JobOS keeps its current model/search selection.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
