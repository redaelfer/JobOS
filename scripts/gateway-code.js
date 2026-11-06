import { runGatewayCommand } from '../lib/gateway.js';
try { await runGatewayCommand('code', process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
