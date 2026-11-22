// Isolated browser smoke test; no real job searches, user profile, CV or mail.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createApp } from '../server.js';
import { starterLatex } from '../lib/tailoring.js';

const dir=await mkdtemp(join(tmpdir(),'jobos-inbox-fixture-'));
const cv=starterLatex('Synthetic person\nPython et SQL pour les données.');
await writeFile(join(dir,'main.tex'),cv);
const posting=n=>({title:'Ingénieur Data Junior',company:'Fixture',stage:'Saved',location:'Maroc',description:'Nous recherchons un ingénieur pour les données avec Python et SQL. Postulez : jobs@example.org.',url:'https://example.org/jobs/'+n,postedAt:'1 day ago'});
let fail=true;
const {store,server,ingest}=createApp({dbPath:':memory:',cvPath:join(dir,'main.tex'),artifactRoot:join(dir,'drafts'),
  statusChecker:async()=>({ready:true}),searcher:async p=>{if(p.jobSite==='indeed' && fail) throw Error('Fixture unavailable'); return {jobs:[posting(p.jobSite==='indeed'?2:1)],summary:'Fixture results'};},
  researcher:async()=>[],analyzer:async({job,language,resume})=>{assert.equal(language,'French');assert.equal(resume,'');return {summary:'Python et SQL.',points:[{requirement:'Python',priority:'required',jobEvidence:job.description,cvEvidence:'Python et SQL',match:'supported',cvAction:'Mentionner Python.',emailAction:'Mentionner SQL.'}],questions:[]};},
  tailorer:async()=>({latex:cv,replacements:[],email:{subject:'Candidature — Data',body:'Bonjour, je vous propose ma candidature. Mon expérience porte sur Python et SQL.'},changes:[],questions:[]}), latexCompiler:async()=>({compilation:'unavailable',compilationMessage:'Synthetic fixture'})});
// This smoke test covers provider retries. Browser mode has check-indeed-browser.js.
store.put('settings',{...store.get('settings','main'),indeedSearchMode:'provider'});
const applied=ingest({...posting(3),stage:'Applied'}).job;
const unreadable=ingest(posting(4)).job;
server.listen(0,'127.0.0.1');await once(server,'listening');
const address='http://127.0.0.1:'+server.address().port;
const browser=process.env.JOBOS_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile=join(dir,'profile');
const edge=spawn(browser,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
edge.on('error',()=>{});
let ws;
try {
  let port;
  for (let i=0;i<150&&!port;i++) {try{port=parseInt(await readFile(join(profile,'DevToolsActivePort'),'utf8'));}catch{await pause(100);}}
  assert.ok(port, 'Browser did not open its local debugging port'); console.log('Isolated headless browser started'); const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await once(ws,'open',{ signal:AbortSignal.timeout(10000) });
  let id=0;const callbacks=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(callbacks.has(m.id)){callbacks.get(m.id)(m);callbacks.delete(m.id);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('Browser did not answer '+method)),10000);callbacks.set(key,m=>{clearTimeout(timer);m.error?reject(Error(m.error.message)):resolve(m.result);});ws.send(JSON.stringify({id:key,method,params}));});
  const js=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};
  const wait=async expr=>{for(let i=0;i<120;i++){if(await js(expr))return;await pause(65);}throw Error('Missing browser state: '+expr);};

  const click=sel=>js('document.querySelector('+JSON.stringify(sel)+').click()');
  const select=(sel,value)=>js('(()=>{const e=document.querySelector('+JSON.stringify(sel)+'); e.value='+JSON.stringify(value)+'; e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await call('Page.navigate',{url:address+'/#search'});
  await wait("!!document.querySelector('[name=indeedOpportunityScope]')");
  await select('[name=indeedOpportunityScope]','morocco-junior-remote');
  await click('#indeed-settings button');
  await wait("document.querySelector('#toast')?.innerText.includes('Indeed settings saved')");
  assert.equal(store.get('settings','main').indeedOpportunityScope,'morocco-junior-remote');
  assert.equal(store.list('scans').length,0);
  await call('Page.navigate',{url:address+'/?fixture=scope#search'});
  await wait("document.querySelector('[name=indeedOpportunityScope]')?.value==='morocco-junior-remote'");
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await js("document.documentElement.scrollWidth <= window.innerWidth"),'Indeed settings fit a narrow viewport');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  const scopeScreenshot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(resolve('test-results/indeed-scope-ui.png'),Buffer.from(scopeScreenshot.data,'base64'));
  console.log('PASS: Indeed scope saved through the real browser form, persisted on reload and fit a narrow viewport; no search started.');
  await call('Page.navigate',{url:address+'/#daily'});
  await wait("document.querySelector('#stage-filter')?.value==='Saved'");
  await click('[data-action=scan-now]');
  await wait("!!document.querySelector('[data-action=retry-source]:not([disabled])')");
  fail=false;await click('[data-action=retry-source]');
  try { await wait("document.querySelector('#main').innerText.includes('2 new in last search') && !document.querySelector('[data-action=retry-source]')"); }
  catch(error) { console.error(JSON.stringify({scans:store.list('scans').map(r=>({status:r.status,summary:r.summary,error:r.error,newJobIds:r.newJobIds})),page:await js("document.querySelector('#main')?.innerText.slice(0,3000)")}));throw error; }
  await click('[data-action=last-search-filter]');assert.equal(await js("document.querySelectorAll('#jobs-area tbody tr').length"),2);
  await click('[data-action=prepare-job]');await wait("!!document.querySelector('#tailor-form')");assert.equal(await js("document.querySelector('#tailor-form [name=language]').value"),'French');
  await click('#tailor-form button[type=submit]');await wait("!!document.querySelector('#tailored-review-form')");
  await js("Object.defineProperty(navigator,'clipboard',{value:{writeText:async v=>{window.fixtureCopy=v}}})");
  for(const field of ['recipientEmail','subject','body']){await click('[data-action=copy-draft-field][data-field='+field+']');assert.equal(await js('window.fixtureCopy'),await js("document.querySelector('#tailored-review-form').elements."+field+".value"));}
  assert.equal(await readFile(join(dir,'main.tex'),'utf8'),cv);
  const toExpire=store.list('jobs').find(j=>j.url===posting(1).url);
  // Fixture output from a browser review. The actual inbox, review actions, API
  // and database below are real; no signed-in production website is visited.
  const match=j=>({jobId:j.id,url:j.url,evidence:'No longer accepting applications'});
  store.put('availabilityChecks',{id:'latest',mode:'browser',reviewId:'fixture-review',status:'completed',completedAt:new Date().toISOString(),total:4,checked:4,noNotice:1,unknown:1,withoutLink:0,matches:[match(toExpire),match(applied)],unverified:[match(unreadable)]});
  await call('Page.navigate',{url:address+'/?fixture=review#pipeline'});
  await wait("!!document.querySelector('[data-action=expire-unavailable]')");
  assert.equal(await js("document.querySelector('#unavailable-offers .offer-link').href"),toExpire.url);
  await click('[data-action=expire-job]');await wait("document.querySelectorAll('#unavailable-offers li').length===1");
  await click('[data-action=expire-unavailable]');await wait("!document.querySelector('#unavailable-offers')");
  await select('#stage-filter','Expired');assert.equal(await js("document.querySelectorAll('#jobs-area tbody tr').length"),2);
  await select('#stage-filter','Applied');assert.ok(await js("document.querySelector('#jobs-area').innerText.includes('Expired posting')"));
  assert.equal(store.get('jobs',applied.id).stage,'Applied');assert.ok(!store.get('jobs',unreadable.id).expiredAt);
  await js("location.hash='#contacts'");await wait("document.querySelector('#main')?.innerText.includes('jobs@example.org')");
  console.log('PASS: Offers defaults, partial search/retry, new filter, French tailoring, three copy actions, immutable master, review links, individual/bulk expiry, applied stage and retained contact.');
} finally {
  ws?.close();edge.kill();server.closeAllConnections();await new Promise(done=>server.close(done));store.db.close();
  if (dirname(resolve(dir)) === resolve(tmpdir())) await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});
}
