import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetJarvisSpineForTests,
  listJarvisEvents,
  upsertJarvisEntity,
  upsertJarvisEvent,
} from './jarvis-spine.js';

afterEach(() => {
  _resetJarvisSpineForTests();
  delete process.env.JARVIS_SPINE_DB_PATH;
});

describe('jarvis spine', () => {
  it('stores normalized events in the shared spine', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-spine-'));
    process.env.JARVIS_SPINE_DB_PATH = path.join(tmpDir, 'jarvis.db');

    upsertJarvisEntity({
      entity_id: 'entity_project_crewops',
      entity_type: 'project',
      name: 'CrewOps',
      aliases: ['crewops'],
      metadata: {},
      updated_at: '2026-03-28T12:00:00.000Z',
    });

    const id = upsertJarvisEvent({
      source: 'nanoclaw',
      source_key: 'message:test',
      event_type: 'conversation_signal',
      occurred_at: '2026-03-28T12:00:00.000Z',
      entity_refs: ['entity_project_crewops'],
      payload: { text: 'CrewOps status please' },
      confidence: 0.8,
    });

    expect(id).toContain('evt_');
    expect(listJarvisEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_id: id,
          event_type: 'conversation_signal',
        }),
      ]),
    );
  });
});
