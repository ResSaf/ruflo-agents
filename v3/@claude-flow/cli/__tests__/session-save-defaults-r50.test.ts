import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { sessionTools } from '../src/mcp-tools/session-tools.js';
const save = (input: object) => sessionTools.find(t => t.name === 'session_save')!.handler({ name: 'snapshot', ...input }) as Promise<any>;
beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-save-defaults-'));
  for (const [kind, data] of Object.entries({ tasks: { tasks: { task1: { taskId: 'task1' } } }, agents: { agents: { agent1: { agentId: 'agent1' } } }, memory: { entries: { key1: { key: 'key1', value: 'value' } } } })) {
    const dir = join(state.cwd, '.claude-flow', kind); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'store.json'), JSON.stringify(data));
  }
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));
it('saves existing stores when MCP callers omit include flags', async () => {
  const result = await save({});
  expect(result.stats).toMatchObject({ tasks: 1, agents: 1, memoryEntries: 1 });
  expect(Object.keys(JSON.parse(readFileSync(result.path, 'utf8')).data).sort()).toEqual(['agents', 'memory', 'tasks']);
});
it.each(['includeTasks', 'includeAgents', 'includeMemory'])('honors explicit false for %s while keeping other stores', async flag => {
  const result = await save({ [flag]: false });
  const statsKey = { includeTasks: 'tasks', includeAgents: 'agents', includeMemory: 'memoryEntries' }[flag]!;
  expect(result.stats[statsKey]).toBe(0);
  expect(['tasks','agents','memoryEntries'].filter(k => k !== statsKey).map(k => result.stats[k])).toEqual([1,1]);
});
it('supports intentionally empty metadata-only sessions', async () => {
  const result = await save({ includeTasks: false, includeAgents: false, includeMemory: false });
  expect(result.stats).toMatchObject({ tasks: 0, agents: 0, memoryEntries: 0 });
  expect(JSON.parse(readFileSync(result.path, 'utf8')).data).toBeUndefined();
});
