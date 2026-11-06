// Works without a coding assistant or model-generation request.
const supported = Number(process.versions.node.split('.')[0]) >= 24;
console.log(`${supported ? 'OK' : 'CHECK'}: Node.js ${process.versions.node}${supported ? '' : ' — install Node.js 24 or newer.'}`);
try {
  const { diagnoseLocalSetup } = await import('../lib/doctor.js');
  const checks = await diagnoseLocalSetup();
  for (const check of checks) console.log(`${check.ok ? 'OK' : 'CHECK'}: ${check.message}`);
  console.log('Full instructions: USER-GUIDE.md, or Help & local setup inside JobOS. No CV or model prompt was sent by this command.');
  if (!supported || checks.some(check => !check.ok)) process.exitCode = 1;
} catch { console.error('Diagnostics could not load. In this project folder, run npm ci, then npm run doctor. Read USER-GUIDE.md for recovery.'); process.exitCode = 1; }
