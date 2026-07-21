# Criminal Dance first formal forward test status

Status: **not started — certification gate unavailable**

The Adapter, game reference, Catalog capabilities, exploration config, four formal candidate profiles, normalized-result validator, Adapter event validator, and Run audit Hook are implemented and their tool tests pass. The real exploratory UI journey completed eight rounds and reached the visible score-to-10 match terminal, but it remains `productVerdict: not_evaluated` and is not formal certification evidence.

The first formal `natural_user` Run was not initialized because this runtime cannot satisfy the user-mandated player-isolation contract:

1. The collaboration runtime has four total concurrent slots including the referee/root agent. A four-player match requires four persistent player agents in addition to the referee (five slots total).
2. Spawned agents inherit the same tool surface. The runtime does not expose a way to create the required no-tools player agents.
3. Starting with fewer agents, reusing an agent across identities, letting the referee choose strategy, or merely instructing a tool-capable agent not to use tools would not prove the requested isolation.

Consequently:

- The selectable formal candidates are `criminaldance-4p-natural-fast.json`, `criminaldance-4p-inspector-targeted-fast.json`, `criminaldance-4p-juvenile-targeted-fast.json`, and `criminaldance-4p-inspector-juvenile-targeted-fast.json`; all correctly fail the Catalog `planned` gate before execution.
- No formal Run directory, agent provenance, Observation→Decision chain, product verdict, or passing formal audit was fabricated.
- Catalog `criminaldance` remains `planned`; base natural play, core rules, Inspector, Juvenile, and the combined-expansion profile are all still `planned`.
- Inspector, Juvenile, and both expansions enabled together each need their own complete formal Run even after the base Run passes. Their setting toggles must exactly match the selected Adapter scenarios, and absence of a naturally visible expansion checkpoint cannot be filled with a fixture or deck-order hook.
- A later run must use four simultaneous persistent `fork_turns: "none"` no-tools agents, record product/test/capability/provenance evidence before play, use `public_ui` for all public DOM evidence, complete one production-time match, and pass the strict audit before promotion to `experimental`.

Exploratory evidence: `runs/20260718-154041-criminaldance-4p` (`incomplete`, `not_evaluated`).

## Maximum-player natural Run attempt

Requested on 2026-07-18 with `playerCount: 8`, `approach: natural_user`, the complete 32-card base deck, `speed.profile: fast`, resolved `serverTimeScale: 1.0`, logs-only evidence, and no reconnect scenario. The reusable candidate is `tests/AI_E2E/configs/criminaldance-8p-natural-fast.json`.

Pre-initialization results:

- JSON parsing and the Adapter tool suite passed.
- Formal config validation stopped with the sole Catalog gate: `犯人在跳舞 has no executable Adapter; set exploratory purpose and allowDiscovery: true to draft one.`
- No Run directory was initialized because the Skill requires stopping after validation failure.
- A compliant eight-player Run also requires eight persistent isolated `fork_turns: "none"` player agents plus the referee. This runtime exposes four total concurrent slots, so only three player agents can coexist with the referee. Reusing agents, rotating identities, or letting the referee choose strategy would invalidate the formal result.

No browser tabs were opened and no gameplay or product verdict was fabricated. Catalog status and all certification evidence arrays remain unchanged.
