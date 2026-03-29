import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { readEnvFile } from './env.js';

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.NANOCLAW_ALLOW_PARENT_ENV;
  delete process.env.NANOCLAW_ENV_FILE;
});

describe('readEnvFile', () => {
  it('reads the local .env file by default', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-env-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'TEST_KEY=local\n', 'utf-8');
    process.chdir(tmpDir);

    expect(readEnvFile(['TEST_KEY'])).toEqual({ TEST_KEY: 'local' });
  });

  it('does not fall back to the parent .env unless explicitly enabled', () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-parent-'));
    const childDir = path.join(parentDir, 'child');
    fs.mkdirSync(childDir);
    fs.writeFileSync(path.join(parentDir, '.env'), 'TEST_KEY=parent\n', 'utf-8');
    process.chdir(childDir);

    expect(readEnvFile(['TEST_KEY'])).toEqual({});

    process.env.NANOCLAW_ALLOW_PARENT_ENV = 'true';
    expect(readEnvFile(['TEST_KEY'])).toEqual({ TEST_KEY: 'parent' });
  });
});
