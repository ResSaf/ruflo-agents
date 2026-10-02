# ruflo-mods

ruflo as a Claude Code mod (function hooks): on by default in Claude Code >= 2.1.287; from 2.1.277 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Design and evidence: [ADR-404](../../v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md), including Amendment 1 (default-on in `ruflo init`).

```bash
ruflo init                          # new projects: mods on by default, in the committed .claude/settings.json
ruflo init upgrade --mods           # existing projects: merge the same keys (never overwrites yours) and install
ruflo mods install                  # just this checkout (.claude/settings.local.json); --scope project for the team
ruflo mods install --source local   # dogfooding: load the mods live from this ruflo checkout (no clone)
ruflo mods doctor                   # marketplace source and freshness, plugins loadable, function hooks, what it owns
ruflo mods uninstall                # claude plugin uninstall what ruflo installed; remove exactly the keys it added
```

These enable `ruflo-mods@ruflo`, `ruflo-swarm@ruflo` and `ruflo-console@ruflo`, the `ruflo` marketplace and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A key you already set is left as it is: a plugin you set to `false` stays off and is never installed. `ruflo init --no-mods` writes none of it.

## What loads

- **ruflo-mods and ruflo-console** run only where function hooks are on. With them off, or with Claude Code's rollout switch off, they do nothing, and the classic hooks keep every event.
- **ruflo-swarm** loads its commands, skills and agents even without function hooks. With them on, it is also a mod that can run host commands (pane actions you start).
- **ruflo-console** is reported as "pending" until it is released in the marketplace.
- **The ruflo marketplace is cloned on first use.** Each teammate's first trusted, interactive Claude Code start clones `github.com/ruvnet/ruflo`. A headless `claude -p` on a fresh config loads nothing. Once the marketplace is cloned, which `ruflo init` does, `claude -p` loads the mods too.
- **Optional hardening:** set `pluginConfigs["ruflo-mods@ruflo"].options.modTrust = "refuse-risky"` with `modTrustAllow` in user or managed settings (e.g. `"ruflo-swarm@ruflo,ruflo-console@ruflo"`: both run host commands, so `refuse-risky` refuses them otherwise). Project settings cannot set it. The default is `observe`, which names what each later mod can do and blocks nothing.

## Install and repair

When a `claude` binary is on PATH, init and install also do what you would do by hand, in the project directory:

```bash
claude plugin marketplace update ruflo                     # or, first time: claude plugin marketplace add ruvnet/ruflo --scope <scope>
claude plugin install ruflo-mods@ruflo --scope <scope>
claude plugin install ruflo-swarm@ruflo --scope <scope>
```

Settings alone are not always enough. Claude Code loads these plugins from its local clone of the `ruflo` marketplace (`~/.claude/plugins/marketplaces/ruflo`, or under `$CLAUDE_CONFIG_DIR`), with or without an install record.

- **No clone yet.** An interactive, trusted session clones it on start. A headless `claude -p` run does not.
- **A stale clone.** A clone from before ruflo-mods shipped has no `plugins/ruflo-mods`, so Claude Code skips the enabled plugin without a word, and `/ruflo-mods` is an unknown command. It does not refresh the clone on start. `ruflo mods doctor` and `ruflo doctor` report this as a failure, with the exact commands above.
- **Why `claude plugin install` too.** It keeps a cached copy that still loads if the clone goes stale later.

`ruflo mods uninstall` runs `claude plugin uninstall <id> --scope <scope>` only for the plugins ruflo itself installed: ones that were not installed before and that ruflo enabled. It then removes exactly the settings keys ruflo added. Both are recorded in `.claude-flow/mods/install.json`.

## Dogfooding: `--source local`

`ruflo mods install --source local` declares the `ruflo` marketplace as a directory source pointing at a ruflo checkout: `--marketplace-path <dir>`, or by default the project root, which must hold the `ruflo` `.claude-plugin/marketplace.json`.

- **Live from the working tree.** Claude Code loads the plugins straight from that directory: no clone, nothing to go stale, and edits show on the next session. Verified on 2.1.287.
- **No `claude plugin install`.** Installing would pin a cached snapshot instead of the live tree.
- **One marketplace per config dir.** Claude Code keeps one `ruflo` marketplace per config dir, so switching it to a directory applies to every project on that machine. Switch back with `claude plugin marketplace add ruvnet/ruflo`.
- **Doctor** reports the source type, and warns when a project declares one source but Claude Code knows `ruflo` by another.

## Flags

- `--no-plugin-install` writes settings only and runs no `claude` command.
- `--dry-run` (`mods install`, `mods uninstall`) prints the settings and the `claude` commands without running either.
- If `claude` is missing or a step fails, the manual commands are printed and the exit code is 0. Pass `--strict` (`mods install`) to exit 1 instead.
- Under `VITEST` or `CI`, init skips the `claude` step and prints the commands.
- Claude Code reformats `.claude/settings.json` (key order) when it installs at project scope. ruflo says so and leaves it: the content is unchanged.

In a session, `/ruflo mods` (through ruflo-console's `/ruflo`) reports what the mod owns, routed, recorded and tightened. `/ruflo-mods` stays as an alias of it (ADR-406: no command is removed or renamed).

## What it does

- **Routing:** `prompt.submit` routes each prompt in-process and hands the route, plus ranked memory, to the model as context. The text is the same as the classic `route` hook produces.
- **Edit learning:** `tool.call` records finished edits for the intelligence consolidator, once per turn.
- **Tool checks:** `tool.check` only tightens. It applies the dangerous-command list and ruflo policy rules that name `claude-code.*` actions (written by the CLI to `.claude-flow/policy/claude-code.json`). It never loosens a verdict.
- **Trust gate:** `plugin.register` names what a later-installed mod can do (host commands, network, environment, tool verdicts) and, under `modTrust: refuse-risky`, refuses it unless allow-listed.
- **`$.ruflo`:** other mods add a status segment with `$.ruflo.segment({ id, text })` instead of drawing a second bar; `lastRoute()` and `snapshot()` read what the mod measured. Contract: `types/index.d.ts`.
- **Budget:** `session.measure` applies the cost-tracker budget ladder to live session cost (`costBudgetUsd`); `costHardStop` halts new subagents at 100%.

The classic `hook-handler.cjs` hooks stay installed and remain the fallback. The mod takes an event only where the classic helper hands it over (`RUFLO_MODS_OWNS`), so nothing fires twice. When the mod is not loaded, every classic hook runs as before.

## Options

Claude Code reads a plugin's options from `pluginConfigs["ruflo-mods@ruflo"].options` in user settings, `--settings` or managed settings. Project settings are not read for this. Every option has a default:

| Option | Default | Effect |
|---|---|---|
| `routeContext` | `true` | Include ranked memory with routes |
| `statusLine` | `true` | One-line ruflo status. Skipped where the ruflo statusLine helper is configured |
| `costBudgetUsd` | `0` (off) | Session budget for the ladder |
| `costHardStop` | `false` | Refuse new subagents at 100% of budget |
| `modTrust` | `observe` | `observe` / `refuse-risky` / `off`: the mod trust gate |
| `modTrustAllow` | `` | Comma-separated plugin ids (`name@marketplace`, e.g. `ruflo-swarm@ruflo,ruflo-console@ruflo`) the gate never refuses |

## Tests

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/ruflo-mods   # real engine; needs the rollout switch on
cd v3/@claude-flow/cli && npx vitest run __tests__/mods/                      # declaration-faithful harness, parity tests
bash plugins/ruflo-mods/scripts/smoke.sh                                       # static security contract
```

To typecheck, load the plugin once (Claude Code >= 2.1.287 writes its declarations into `.claude-plugin/types/`), then run `npx tsc -p plugins/ruflo-mods`.
