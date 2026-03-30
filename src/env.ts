import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const candidateSet = new Set<string>();
  const explicitEnvFile = process.env.NANOCLAW_ENV_FILE?.trim();
  if (explicitEnvFile) {
    candidateSet.add(path.resolve(explicitEnvFile));
  }
  candidateSet.add(path.join(process.cwd(), '.env'));
  if (process.env.NANOCLAW_ALLOW_PARENT_ENV === 'true') {
    candidateSet.add(path.join(process.cwd(), '..', '.env'));
  }
  const candidates = [...candidateSet];

  const contents: Array<{ envFile: string; content: string }> = [];
  for (const envFile of candidates) {
    try {
      contents.push({
        envFile,
        content: fs.readFileSync(envFile, 'utf-8'),
      });
    } catch {
      continue;
    }
  }

  if (contents.length === 0) {
    logger.debug('.env file not found in configured locations, using defaults');
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);
  const loadedFrom: string[] = [];

  for (const { envFile, content } of contents) {
    loadedFrom.push(envFile);
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!wanted.has(key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value && !(key in result)) result[key] = value;
    }
  }

  logger.debug({ keys, loadedFrom }, 'Loaded env vars from file');
  return result;
}
