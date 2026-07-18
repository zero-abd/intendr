# @striderlabs MCP smoke test

An isolated harness that smoke-tests a representative sample of the
[`@striderlabs/*`](https://www.npmjs.com/search?q=%40striderlabs) MCP servers
(169 published as of writing — this covers ~9 across categories).

## What it does (and doesn't)

These servers automate **real accounts** — placing DoorDash orders, booking
flights, filing insurance claims — via browser automation. So this harness is
**deliberately non-functional**. For each server it only:

1. spawns the server process over stdio,
2. runs the MCP `initialize` handshake,
3. calls `tools/list` (and `resources/list` if advertised).

It **never invokes a tool**, so no browser is driven, no credentials are needed,
and no real order/booking is ever placed. A server passes if it starts up and
reports a valid tool list.

## Sample covered

doordash · airbnb · spotify · gmail · amazon · uber · yelp · googlemaps · opentable

## Run

```bash
cd test/mcp-smoke
npm install       # installs the sampled servers + MCP client SDK locally
npm test
```

Exit code `0` = all passed, `1` = at least one failed, `2` = harness crashed.

## Notes

- Kept out of the Bun workspace (root globs are `apps/*` / `packages/*`), with
  its own `node_modules`, so it never pollutes the main project.
- Some servers depend on `patchright` (a Playwright fork). Startup does **not**
  launch a browser — that only happens when a tool is actually called, which
  this harness never does.
- To cover more servers, add package names to `PACKAGES` in `smoke-test.mjs`
  and to `dependencies` in `package.json`.
