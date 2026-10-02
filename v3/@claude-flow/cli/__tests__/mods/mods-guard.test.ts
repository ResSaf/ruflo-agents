/**
 * ADR-404 — the mod's `tool.check` only tightens. These tests hold that over
 * every chain verdict, the fail-closed paths, ruflo policy modes, and parity
 * with the real policy evaluator and hook-handler.cjs pre-bash list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ruleMatches as engineRuleMatches, type PolicyRule, type PolicyRequest } from '@claude-flow/security';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { DANGEROUS_COMMANDS } from '../../../../../plugins/ruflo-mods/hooks/guard/dangerous-command';
import { parseProjection, ruleMatches, toolRequest, type ProjectedRule } from '../../../../../plugins/ruflo-mods/hooks/guard/policy';
import { stricter } from '../../../../../plugins/ruflo-mods/hooks/guard/verdict';
import { loadMod, memoryWorld, type World } from './harness';

const HELPERS = join(resolve(__dirname, '../..'), '.claude', 'helpers');
const PROJECTION = '/work/.claude-flow/policy/claude-code.json';
const RANK = { allow: 0, ask: 1, deny: 2 } as const;
type D = keyof typeof RANK;

async function started(world: World) {
  const mod = loadMod(register, world);
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}

function withProjection(world: World, mode: string, rules: unknown[]) {
  (world.files as Map<string, { text: string; mtimeMs: number }>).set(PROJECTION, {
    text: JSON.stringify({ version: 1, mode, generatedAt: 1, rules }),
    mtimeMs: Date.now() + Math.random(),
  });
}

const check = (mod: Awaited<ReturnType<typeof started>>, tool: string, input: unknown, chain: { decision: D; reason?: string; rule?: string }) =>
  mod.dispatch('tool.check', { tool, input, tool_use_id: 't1' }, () => chain);

const DENY_BASH_RULE = { id: 'no-push', effect: 'deny', actions: ['claude-code.tool.Bash'], resources: ['git push*'] };
const ASK_EDIT_RULE = { id: 'review-edits', effect: 'require_approval', actions: ['claude-code.tool.Edit'] };

describe('ADR-404 tool.check never loosens', () => {
  const calls: Array<[string, unknown]> = [
    ['Bash', { command: 'ls' }],
    ['Bash', { command: 'rm -rf /' }],
    ['Bash', { command: 'git push origin main' }],
    ['Edit', { file_path: '/work/a.ts' }],
    ['Read', { file_path: '/work/a.ts' }],
    ['Bash', null],
    ['Bash', { command: 42 }],
  ];
  const chains = [
    { decision: 'allow' as D },
    { decision: 'ask' as D, reason: 'mode asks' },
    { decision: 'deny' as D, reason: 'Bash(rm:*)', rule: 'Bash(rm:*)' },
  ];

  for (const mode of ['legacy', 'observe', 'enforce', 'absent', 'garbage']) {
    it(`in policy mode ${mode}, for every call and chain verdict`, async () => {
      const world = memoryWorld();
      if (mode === 'garbage') (world.files as Map<string, any>).set(PROJECTION, { text: '{not json', mtimeMs: 1 });
      else if (mode !== 'absent') withProjection(world, mode, [DENY_BASH_RULE, ASK_EDIT_RULE]);
      const mod = await started(world);
      for (const [tool, input] of calls) {
        for (const chain of chains) {
          const out = await check(mod, tool, input, chain);
          expect(RANK[out.decision as D]).toBeGreaterThanOrEqual(RANK[chain.decision]);
          // Never rewritten: where ruflo does not tighten, the chain's own object (rule and all) stands.
          if (RANK[out.decision as D] === RANK[chain.decision]) expect(out).toBe(chain);
        }
      }
    });
  }

  it('stricter() keeps the chain object on ties and lets nothing loosen', () => {
    const chain = { decision: 'deny' as const, rule: 'Read(.env)' };
    expect(stricter(chain, { decision: 'allow' })).toBe(chain);
    expect(stricter(chain, { decision: 'ask' })).toBe(chain);
    expect(stricter(chain, { decision: 'deny', reason: 'ours' })).toBe(chain);
    expect(stricter({ decision: 'allow' }, undefined)).toEqual({ decision: 'allow' });
  });
});

describe('ADR-404 ruflo verdicts', () => {
  it('blocks the pre-bash list whatever the policy', async () => {
    const mod = await started(memoryWorld());
    const out = await check(mod, 'Bash', { command: 'sudo RM -RF / --no-preserve-root' }, { decision: 'allow' });
    expect(out).toMatchObject({ decision: 'deny' });
    expect(out.reason).toContain('rm -rf /');
  });

  it('enforce: a deny rule denies, an approval rule asks, an allow rule says nothing', async () => {
    const world = memoryWorld();
    withProjection(world, 'enforce', [DENY_BASH_RULE, ASK_EDIT_RULE, { id: 'all-read', effect: 'allow', actions: ['claude-code.tool.Read'] }]);
    const mod = await started(world);
    expect(await check(mod, 'Bash', { command: 'git push origin main' }, { decision: 'allow' })).toMatchObject({ decision: 'deny', reason: 'ruflo policy: denied-by:no-push' });
    expect(await check(mod, 'Edit', { file_path: 'x' }, { decision: 'allow' })).toMatchObject({ decision: 'ask' });
    const askChain = { decision: 'ask' as D };
    expect(await check(mod, 'Read', { file_path: 'x' }, askChain)).toBe(askChain);
  });

  it('enforce never applies the engine default-deny to a tool no rule names', async () => {
    const world = memoryWorld();
    withProjection(world, 'enforce', [DENY_BASH_RULE]);
    const mod = await started(world);
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'WebFetch', { url: 'https://x' }, chain)).toBe(chain);
  });

  it('observe logs what enforce would do and changes nothing', async () => {
    const world = memoryWorld();
    withProjection(world, 'observe', [DENY_BASH_RULE]);
    const mod = await started(world);
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'Bash', { command: 'git push' }, chain)).toBe(chain);
    expect(world.logs.join('\n')).toContain('denied-by:no-push');
  });

  it('a rule with no claude-code action (or only *) never reaches Claude Code tools', () => {
    const p = parseProjection(JSON.stringify({ version: 1, mode: 'enforce', rules: [
      { id: 'mcp', effect: 'deny', actions: ['mcp.tool.call'] },
      { id: 'star', effect: 'deny', actions: ['*'] },
      { id: 'cc', effect: 'deny', actions: ['claude-code.tool.*'] },
    ] }));
    expect(p.rules.map((r) => r.id)).toEqual(['cc']);
  });

  it('fails closed by one step on a projection that exists but cannot be read', async () => {
    for (const text of ['{not json', JSON.stringify({ version: 2, mode: 'enforce', rules: [] }), JSON.stringify({ version: 1, mode: 'enforce', rules: [{ id: 1 }] })]) {
      const world = memoryWorld();
      (world.files as Map<string, any>).set(PROJECTION, { text, mtimeMs: 1 });
      const mod = await started(world);
      expect(await check(mod, 'Read', { file_path: 'x' }, { decision: 'allow' })).toMatchObject({ decision: 'ask' });
      const deny = { decision: 'deny' as D, rule: 'r' };
      expect(await check(mod, 'Read', { file_path: 'x' }, deny)).toBe(deny);
    }
  });

  it('a refused ui.log is swallowed: observe still changes nothing', async () => {
    const world = memoryWorld();
    withProjection(world, 'observe', [DENY_BASH_RULE]);
    world.failLog = true;
    const mod = await started(world);
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'Bash', { command: 'git push' }, chain)).toBe(chain);
  });

  it('when the world beneath fails, the catch answers ask: ruflo could not judge', async () => {
    const mod = await started(memoryWorld());
    const out = await mod.dispatch('tool.check', { tool: 'Read', input: {}, tool_use_id: 'x' }, () => {
      throw new Error('engine verdict failed');
    });
    expect(out).toMatchObject({ decision: 'ask' });
  });

  it('an absent projection is no policy, not a failure', async () => {
    const mod = await started(memoryWorld());
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'Edit', { file_path: 'x' }, chain)).toBe(chain);
  });
});

describe('ADR-404 parity', () => {
  it('carries hook-handler.cjs pre-bash list exactly', () => {
    const source = readFileSync(join(HELPERS, 'hook-handler.cjs'), 'utf8');
    const literal = source.match(/const dangerous = (\[[^\]]*\]);/)?.[1];
    expect(literal).toBeDefined();
    expect(new Function(`return ${literal}`)()).toEqual(DANGEROUS_COMMANDS);
  });

  it('ruleMatches agrees with @claude-flow/security on every rule × request', () => {
    const rules: ProjectedRule[] = [];
    const actionsSet = [['claude-code.tool.Bash'], ['claude-code.tool.*'], ['claude-code.*', 'mcp.tool.call'], ['claude-code.tool.Edit']];
    const optional = {
      resources: [undefined, ['git push*'], ['/work/*'], ['*']],
      principals: [undefined, ['claude-code'], ['someone-else']],
      identityTypes: [undefined, ['agent'], ['user']],
      roles: [undefined, ['admin']],
      environments: [undefined, ['prod']],
      constraints: [undefined, { destructive: false }, { network: false }, { maxCostUsd: 1 }, { requireSignedEvidence: true }, { requiredProvenance: ['tool_result'] }, { allowedNamespaces: ['x'] }, { destructive: true }],
      enabled: [undefined, false],
    };
    let i = 0;
    for (const actions of actionsSet) for (const resources of optional.resources) for (const principals of optional.principals)
      for (const identityTypes of optional.identityTypes) for (const constraints of optional.constraints) for (const enabled of optional.enabled) {
        rules.push({ id: `r${i++}`, effect: 'deny', actions, resources, principals, identityTypes: identityTypes as any, constraints, enabled,
          ...(i % 3 === 0 ? { roles: ['admin'] } : {}), ...(i % 5 === 0 ? { environments: ['prod'] } : {}) });
      }
    const calls: Array<[string, unknown]> = [['Bash', { command: 'git push origin' }], ['Bash', { command: 'ls' }], ['Edit', { file_path: '/work/a.ts' }],
      ['WebFetch', { url: 'https://e' }], ['Read', {}], ['mcp__x__y', {}]];
    let compared = 0;
    for (const [tool, input] of calls) {
      const req = toolRequest(tool, input);
      const engineReq: PolicyRequest = { identity: { ...req.identity, roles: undefined } as PolicyRequest['identity'], action: { ...req.action }, context: {} };
      for (const rule of rules) {
        expect(ruleMatches(rule, req), `${rule.id} ${tool}`).toBe(engineRuleMatches(rule as unknown as PolicyRule, engineReq));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });
});
