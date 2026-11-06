import { runGatewayCommand } from '../lib/gateway.js';
try { await runGatewayCommand('models'); }
catch (error) { console.error(error.message); process.exitCode = 1; }
