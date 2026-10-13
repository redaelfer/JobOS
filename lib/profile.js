import { createHash } from 'node:crypto';
import { searchPreferences } from './discovery.js';

export function automationPreferences(settings) {
  return searchPreferences({ domains: settings.searchDomains || 'Software engineering, Backend development, Frontend development, Full-stack development, AI engineering, Data engineering, DevOps engineering, QA and test automation', location: settings.searchLocation || 'Morocco and remote roles', level: settings.searchLevel || 'Graduate / Entry level', exclude: settings.searchExclude || 'unpaid, senior', maxAgeDays: settings.searchMaxAgeDays ?? 30, includeReview: settings.searchIncludeReview ?? true });
}
export const resumeFingerprint = settings => createHash('sha256').update(settings.resume || '').digest('hex');
export function preferenceFingerprint(settings) {
  const { maxAgeDays, includeReview, ...preferences } = automationPreferences(settings);
  return createHash('sha256').update(JSON.stringify(preferences)).digest('hex');
}
export const minimumFit = settings => Number.isInteger(Number(settings.minimumFit)) && Number(settings.minimumFit) >= 0 && Number(settings.minimumFit) <= 100 ? Number(settings.minimumFit) : 70;
