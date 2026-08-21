---
name: verify-plan-implementation
description: Cross-checks a written plan (markdown checklist, phases, or acceptance criteria) against the repository and git state, then reports what is done, partial, or missing plus risks. Use when the user asks to verify plan implementation, audit a spec against code, confirm a roadmap is complete, or summarize gaps after a feature rollout.
---

# Verify plan implementation

## When invoked

The user supplies or points to a **plan** (file path, PR description, ticket, or pasted outline). If no plan is given, ask once for the plan source or paste; if they refuse, infer the most recent plan-like doc in `docs/` or the conversation and state that assumption explicitly.

## Workflow

1. **Normalize the plan**  
   Extract discrete items: numbered steps, checkboxes, headings, or acceptance criteria. Treat each as a verifiable claim (behavior, file, API, config, test).

2. **Verify against the repo**  
   For each item: use search and targeted file reads (and tests or scripts if appropriate). Classify:
   - **Done** — behavior or artifact clearly present and wired.
   - **Partial** — stub, feature flag off, wrong path, or incomplete edge handling.
   - **Missing** — not found or contradicted by code.
   - **Unclear** — plan ambiguous; note what would resolve it.

3. **Check surrounding risks**  
   Briefly scan for: missing or skipped tests, env vars / deployment config not documented, contract drift (e.g. API vs client), dead code paths, TODOs that contradict the plan, security or data-handling gaps tied to the plan.

4. **Summarize**  
   Use the output template below. Be factual; distinguish evidence from inference. Prefer citing paths and symbols over vague claims.

## Output template

```markdown
## Plan verification summary

**Plan source:** [path or description]

### Implemented
- [item] — [evidence: file(s), behavior]

### Partial / needs follow-up
- [item] — [what exists vs what is missing]

### Not implemented / not found
- [item] — [what was checked]

### Potential problems & risks
- [risk] — [severity: high/medium/low] — [why]

### Suggested next steps
- [ordered, concrete actions]
```

## Constraints

- Do not claim an item is **Done** without locating implementation or a test that exercises it.
- If the plan references external systems (Azure, LLM providers), note **unverified in this environment** when you cannot run integration checks.
- Keep the summary proportional to plan size; merge trivial adjacent items when it improves clarity.
