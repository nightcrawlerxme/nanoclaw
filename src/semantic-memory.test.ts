import fs from 'fs';
import os from 'os';
import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSemanticMemoryContext,
  retrieveRelevantMemories,
} from './semantic-memory.js';

function writeClaudeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

function fakeEmbedTexts(
  texts: string[],
  _inputType: 'passage' | 'query',
): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const lowered = text.toLowerCase();
      const government =
        lowered.includes('government') || lowered.includes('tender') ? 1 : 0;
      const sales =
        lowered.includes('sales') || lowered.includes('prospect') ? 1 : 0;
      const memory = lowered.includes('memory') ? 1 : 0;
      return [government, sales, memory];
    }),
  );
}

describe('semantic-memory', () => {
  let groupsDir: string;

  beforeEach(() => {
    groupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-semantic-'));
  });

  it('retrieves the most relevant memory blocks for a query', async () => {
    writeClaudeFile(
      path.join(groupsDir, 'team', 'CLAUDE.md'),
      `# Team memory

<!-- memory-start: gov-note -->
fitness: 0.9
recency: 0
frequency: 3
tags:
  - government
---
Remember the government tender summary before drafting the bid response.
<!-- memory-end: gov-note -->

<!-- memory-start: sales-note -->
fitness: 0.2
recency: 0
frequency: 1
tags:
  - sales
---
Keep outreach short for warm prospects.
<!-- memory-end: sales-note -->
`,
    );

    const matches = await retrieveRelevantMemories(
      'team',
      'Find the best government tender memory',
      { groupsDir, embedTexts: fakeEmbedTexts, maxMatches: 2 },
    );

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toContain('gov-note');
  });

  it('formats semantic memory context for prompt injection', async () => {
    writeClaudeFile(
      path.join(groupsDir, 'team', 'CLAUDE.md'),
      `# Team memory

<!-- memory-start: mem-1 -->
fitness: 0.8
recency: 0
frequency: 2
tags:
  - memory
---
Recall the prior architecture decision about semantic memory and LanceDB.
<!-- memory-end: mem-1 -->
`,
    );

    const context = await buildSemanticMemoryContext(
      'team',
      'What did we decide about memory retrieval?',
      { groupsDir, embedTexts: fakeEmbedTexts, maxMatches: 2 },
    );

    expect(context).toContain('Relevant semantic memory:');
    expect(context).toContain('mem-1');
    expect(context).toContain('LanceDB');
  });

  it('bootstraps legacy prose-only CLAUDE files into retrievable memory blocks', async () => {
    const filePath = path.join(groupsDir, 'legacy', 'CLAUDE.md');
    writeClaudeFile(
      filePath,
      `# Panda

## Government Tender Notes

Joseph wants government tender follow-up to emphasize compliance, delivery risk, proposal timelines, and procurement fit.

## Sales Direction

Keep outreach short for warm prospects and focus on direct next steps.`,
    );

    const context = await buildSemanticMemoryContext(
      'legacy',
      'Need the government tender follow-up guidance',
      { groupsDir, embedTexts: fakeEmbedTexts, maxMatches: 2 },
    );

    expect(context).toContain('Relevant semantic memory:');
    expect(context).toContain('government');
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('<!-- memory-start:');
  });

  it('does not rewrite the global CLAUDE file during legacy bootstrap', async () => {
    const globalPath = path.join(groupsDir, 'global', 'CLAUDE.md');
    writeClaudeFile(
      globalPath,
      `# Global memory

## Founder Direction

WAIT-Agent-OS should preserve founder context and make NanoClaw and CrewOps work together cleanly.`,
    );
    writeClaudeFile(
      path.join(groupsDir, 'team', 'CLAUDE.md'),
      `# Team memory

<!-- memory-start: team-note -->
fitness: 0.5
recency: 0
frequency: 1
tags:
  - memory
---
Team-specific memory about project execution.
<!-- memory-end: team-note -->
`,
    );

    const before = fs.readFileSync(globalPath, 'utf-8');
    const context = await buildSemanticMemoryContext(
      'team',
      'What is the founder direction for WAIT-Agent-OS?',
      { groupsDir, embedTexts: fakeEmbedTexts, maxMatches: 2 },
    );

    expect(context).toContain('Relevant semantic memory:');
    expect(fs.readFileSync(globalPath, 'utf-8')).toBe(before);
  });

  it('reuses persisted passage vectors when only memory metadata changes', async () => {
    const embedTexts = vi.fn(fakeEmbedTexts);
    writeClaudeFile(
      path.join(groupsDir, 'team', 'CLAUDE.md'),
      `# Team memory

<!-- memory-start: gov-note -->
fitness: 0.9
recency: 0
frequency: 3
tags:
  - government
---
Remember the government tender summary before drafting the bid response.
<!-- memory-end: gov-note -->
`,
    );

    await retrieveRelevantMemories(
      'team',
      'Find the best government tender memory',
      { groupsDir, embedTexts, maxMatches: 2 },
    );
    await retrieveRelevantMemories(
      'team',
      'Find the best government tender memory again',
      { groupsDir, embedTexts, maxMatches: 2 },
    );

    const passageCalls = embedTexts.mock.calls.filter(
      ([, inputType]) => inputType === 'passage',
    );
    const queryCalls = embedTexts.mock.calls.filter(
      ([, inputType]) => inputType === 'query',
    );

    expect(passageCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(2);
  });
});
