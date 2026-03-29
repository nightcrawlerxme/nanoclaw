import fs from 'fs';
import path from 'path';

import OpenAI from 'openai';
import * as lancedb from '@lancedb/lancedb';

import { GROUPS_DIR } from './config.js';
import { readEnvFile } from './env.js';
import {
  MemoryBlock,
  parseMemoryFile,
  scoreAllMemories,
  serializeMemoryFile,
  touchMemory,
} from './memory-ecology.js';
import { logger } from './logger.js';

const TABLE_NAME = 'blocks';
const MAX_CONTEXT_MATCHES = 3;

export interface SemanticMemoryMatch {
  id: string;
  sourcePath: string;
  sourceKind: 'group' | 'global';
  content: string;
  tags: string[];
  fitness: number;
  semanticScore: number;
  combinedScore: number;
}

interface IndexedMemoryRow {
  id: string;
  sourcePath: string;
  sourceKind: string;
  content: string;
  tagsText: string;
  fitness: number;
  lastAccessedAt: string;
  vector: number[];
}

interface MemorySource {
  sourcePath: string;
  sourceKind: 'group' | 'global';
  blocks: MemoryBlock[];
}

export interface SemanticMemoryOptions {
  groupsDir?: string;
  embedTexts?: (
    texts: string[],
    inputType: 'passage' | 'query',
  ) => Promise<number[][]>;
  maxMatches?: number;
}

function compact(text: string, limit = 280): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 3).trimEnd()}...`;
}

function memoryFilePath(baseDir: string, folder: string): string {
  return path.join(baseDir, folder, 'CLAUDE.md');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function inferTags(title: string, content: string): string[] {
  const haystack = `${title} ${content}`.toLowerCase();
  const tags = new Set<string>();
  const keywordGroups: Array<[string, RegExp]> = [
    ['government', /\b(government|tender|procurement|canadabuys|proposal)\b/],
    ['sales', /\b(sales|prospect|outreach|lead|proposal)\b/],
    ['marketing', /\b(marketing|seo|campaign|brand|social media)\b/],
    ['hr', /\b(hiring|hr|candidate|job search|contractor)\b/],
    ['tech', /\b(code|github|api|build|deploy|debug|agent-s)\b/],
    ['operations', /\b(dispatch|status|restart|service|task|health)\b/],
    ['memory', /\b(memory|context|history|recall)\b/],
  ];

  for (const [tag, pattern] of keywordGroups) {
    if (pattern.test(haystack)) tags.add(tag);
  }

  return [...tags];
}

function bootstrapLegacyMemory(
  raw: string,
  sourceKind: 'group' | 'global',
): MemoryBlock[] {
  const sections = raw
    .split(/\n(?=# )|\n(?=## )|\n(?=### )/g)
    .map((section) => section.trim())
    .filter(Boolean);
  const now = new Date().toISOString();
  const blocks: MemoryBlock[] = [];

  for (const [index, section] of sections.entries()) {
    const lines = section.split('\n').map((line) => line.trimEnd());
    const heading = lines[0]?.match(/^#{1,6}\s+(.*)$/)?.[1]?.trim() || '';
    const body = lines
      .slice(heading ? 1 : 0)
      .join('\n')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (body.length < 80) continue;

    const title = heading || `legacy-${index + 1}`;
    blocks.push({
      id: `${sourceKind}-${slugify(title) || `legacy-${index + 1}`}`,
      content: body,
      fitness: 0.35,
      recency: 0,
      frequency: 1,
      tags: inferTags(title, body),
      created_at: now,
      last_accessed_at: now,
    });
  }

  return blocks.slice(0, 8);
}

function loadAndBootstrapMemorySource(
  sourcePath: string,
  sourceKind: 'group' | 'global',
): MemorySource | null {
  const raw = fs.readFileSync(sourcePath, 'utf-8');
  let parsed = parseMemoryFile(raw);

  if (parsed.blocks.length === 0 && parsed.prose.trim().length > 0) {
    const bootstrappedBlocks = bootstrapLegacyMemory(parsed.prose, sourceKind);
    if (bootstrappedBlocks.length > 0) {
      parsed = {
        ...parsed,
        blocks: bootstrappedBlocks,
      };
      const scored = scoreAllMemories(parsed);
      fs.writeFileSync(sourcePath, serializeMemoryFile(scored));
      logger.info(
        {
          sourcePath,
          sourceKind,
          blocks: scored.blocks.length,
        },
        'Bootstrapped legacy CLAUDE memory into structured blocks',
      );
      return {
        sourceKind,
        sourcePath,
        blocks: scored.blocks,
      };
    }
  }

  const scored = scoreAllMemories(parsed);
  if (scored.blocks.length === 0) return null;
  return {
    sourceKind,
    sourcePath,
    blocks: scored.blocks,
  };
}

function loadMemorySources(
  groupFolder: string,
  groupsDir: string,
): MemorySource[] {
  const sources: MemorySource[] = [];
  const candidates: Array<{
    sourceKind: 'group' | 'global';
    sourcePath: string;
  }> = [
    {
      sourceKind: 'group',
      sourcePath: memoryFilePath(groupsDir, groupFolder),
    },
    {
      sourceKind: 'global',
      sourcePath: memoryFilePath(groupsDir, 'global'),
    },
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.sourcePath)) continue;
    try {
      const source = loadAndBootstrapMemorySource(
        candidate.sourcePath,
        candidate.sourceKind,
      );
      if (!source) continue;
      sources.push(source);
    } catch (err) {
      logger.warn(
        { groupFolder, sourcePath: candidate.sourcePath, err },
        'Failed to load semantic memory source',
      );
    }
  }

  return sources;
}

async function buildDefaultEmbedder(
  texts: string[],
  inputType: 'passage' | 'query',
): Promise<number[][]> {
  const envVars = readEnvFile(['NVIDIA_API_KEY']);
  const apiKey = process.env.NVIDIA_API_KEY || envVars.NVIDIA_API_KEY || '';
  if (!apiKey) {
    logger.debug(
      'semantic-memory: NVIDIA_API_KEY not set, skipping vector retrieval',
    );
    return [];
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  const response = await (
    client.embeddings.create as unknown as (
      params: Record<string, unknown>,
    ) => Promise<{
      data: Array<{ embedding: number[] }>;
    }>
  )({
    input: texts,
    model: 'nvidia/nv-embedqa-e5-v5',
    input_type: inputType,
    truncate: 'END',
  });
  return response.data.map((item) => item.embedding);
}

async function openTable(groupsDir: string, groupFolder: string) {
  const dbPath = path.join(groupsDir, groupFolder, 'memory.lance');
  fs.mkdirSync(dbPath, { recursive: true });
  const db = await lancedb.connect(dbPath);
  try {
    return await db.openTable(TABLE_NAME);
  } catch {
    return null;
  }
}

async function persistSources(
  groupFolder: string,
  sources: MemorySource[],
  embedTexts: (
    texts: string[],
    inputType: 'passage' | 'query',
  ) => Promise<number[][]>,
  groupsDir: string,
): Promise<void> {
  const rows: IndexedMemoryRow[] = [];
  for (const source of sources) {
    const embeddings = await embedTexts(
      source.blocks.map((block) => block.content),
      'passage',
    );
    for (const [index, block] of source.blocks.entries()) {
      const vector = embeddings[index];
      if (!vector) continue;
      rows.push({
        id: `${source.sourceKind}:${block.id}`,
        sourcePath: source.sourcePath,
        sourceKind: source.sourceKind,
        content: block.content,
        tagsText: block.tags.join(','),
        fitness: block.fitness,
        lastAccessedAt: block.last_accessed_at,
        vector,
      });
    }
  }

  if (rows.length === 0) return;

  const dbPath = path.join(groupsDir, groupFolder, 'memory.lance');
  fs.mkdirSync(dbPath, { recursive: true });
  const db = await lancedb.connect(dbPath);
  let table = await openTable(groupsDir, groupFolder);
  if (!table) {
    await db.createTable(
      TABLE_NAME,
      rows as unknown as Record<string, unknown>[],
    );
    return;
  }
  try {
    await table.delete('id IS NOT NULL');
  } catch {
    // Fresh table with no rows may reject broad deletes on some versions.
  }
  await table.add(rows as unknown as Record<string, unknown>[]);
}

async function touchMatchedBlocks(
  matches: SemanticMemoryMatch[],
  groupsDir: string,
): Promise<void> {
  const byPath = new Map<string, Set<string>>();
  for (const match of matches) {
    const blockId = match.id.includes(':')
      ? match.id.split(':', 2)[1]
      : match.id;
    const ids = byPath.get(match.sourcePath) || new Set<string>();
    ids.add(blockId);
    byPath.set(match.sourcePath, ids);
  }

  for (const [sourcePath, ids] of byPath.entries()) {
    if (!fs.existsSync(sourcePath)) continue;
    try {
      let memoryFile = scoreAllMemories(
        parseMemoryFile(fs.readFileSync(sourcePath, 'utf-8')),
      );
      for (const blockId of ids) {
        memoryFile = touchMemory(memoryFile, blockId);
      }
      memoryFile = scoreAllMemories(memoryFile);
      fs.writeFileSync(sourcePath, serializeMemoryFile(memoryFile));
    } catch (err) {
      logger.warn(
        { sourcePath, err },
        'Failed to touch semantic memory blocks',
      );
    }
  }
}

export async function retrieveRelevantMemories(
  groupFolder: string,
  query: string,
  options: SemanticMemoryOptions = {},
): Promise<SemanticMemoryMatch[]> {
  const groupsDir = options.groupsDir || GROUPS_DIR;
  const embedTexts = options.embedTexts || buildDefaultEmbedder;
  const maxMatches = options.maxMatches || MAX_CONTEXT_MATCHES;
  const sources = loadMemorySources(groupFolder, groupsDir);
  if (sources.length === 0) return [];

  await persistSources(groupFolder, sources, embedTexts, groupsDir);
  const queryEmbedding = await embedTexts([query], 'query');
  const vector = queryEmbedding[0];
  if (!vector) return [];

  const table = await openTable(groupsDir, groupFolder);
  if (!table) return [];
  const rows = (await table
    .vectorSearch(vector)
    .limit(Math.max(maxMatches * 3, 6))
    .toArray()) as Array<IndexedMemoryRow & { _distance?: number }>;

  const matches = rows
    .map((row) => {
      const semanticScore = 1 / (1 + (row._distance ?? 1));
      const fitness = typeof row.fitness === 'number' ? row.fitness : 0;
      const combinedScore = semanticScore * 0.75 + fitness * 0.25;
      return {
        id: row.id,
        sourcePath: row.sourcePath,
        sourceKind: row.sourceKind === 'global' ? 'global' : 'group',
        content: row.content,
        tags:
          typeof row.tagsText === 'string' && row.tagsText.length > 0
            ? row.tagsText
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
            : [],
        fitness,
        semanticScore,
        combinedScore,
      } satisfies SemanticMemoryMatch;
    })
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, maxMatches);

  await touchMatchedBlocks(matches, groupsDir);
  if (matches.length > 0) {
    const refreshedSources = loadMemorySources(groupFolder, groupsDir);
    await persistSources(groupFolder, refreshedSources, embedTexts, groupsDir);
  }

  return matches;
}

export async function buildSemanticMemoryContext(
  groupFolder: string,
  query: string,
  options: SemanticMemoryOptions = {},
): Promise<string> {
  try {
    const matches = await retrieveRelevantMemories(groupFolder, query, options);
    if (matches.length === 0) return '';
    const lines = matches.map((match, index) => {
      const tags = match.tags.length > 0 ? ` tags=${match.tags.join(',')}` : '';
      return `${index + 1}. [${match.sourceKind}] ${match.id} score=${match.combinedScore.toFixed(2)}${tags}\n${compact(match.content)}`;
    });
    return [
      'Relevant semantic memory:',
      ...lines,
      'Use these snippets as recall cues only. Prefer them over re-reading the full memory file unless you need more detail.',
    ].join('\n\n');
  } catch (err) {
    logger.warn({ groupFolder, err }, 'Semantic memory retrieval failed');
    return '';
  }
}
