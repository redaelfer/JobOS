import { extractLinkedInJob } from './extract.js';
import { readIndeedPage } from './indeed-reader.js';

export function captureSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (/(^|\.)linkedin\.com$/.test(url.hostname)) return 'LinkedIn extension';
    if (/^(?:www|[a-z]{2})\.indeed\.com$/.test(url.hostname)) return 'Indeed extension';
  } catch { /* The editable URL may be incomplete. */ }
  return '';
}

// Same Indeed reader for manual capture and the sequential search controller.
export async function captureJob(api, tab, wait = ms => new Promise(r => setTimeout(r, ms))) {
  const source = captureSource(tab?.url);
  if (!source) throw Error('Open a LinkedIn or Indeed job posting, then capture it again.');
  const indeed = source === 'Indeed extension';
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    const [response] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: indeed ? readIndeedPage : extractLinkedInJob,
      ...(indeed ? { args: [{ type: 'detail', url: tab.url }] } : {}) });
    if (response?.error) throw Error(response.error.message || 'Could not read this posting.');
    const observation = response?.result;
    if (indeed && observation?.blocked) throw Error('Indeed is showing verification or sign-in. Complete it yourself in the job tab, then capture again.');
    if (indeed && observation?.attention === 'wrong_page') throw Error('Open the full Indeed job posting (with a job ID in its address), then capture again.');
    result = indeed ? observation?.job : observation;
    if (result?.title && result?.company && result?.description) break;
    if (attempt < 3) await wait(600);
  }
  if (!result) throw Error('Could not read this job. Open a LinkedIn or Indeed posting, or fill the fields manually.');
  return { ...result, source };
}
