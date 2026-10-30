# Tool and HTTP interface

MCP registration is implemented by `src/lib/campaigns/mcp.ts` (`registerCampaignTools`). It needs to be registered on the per-member authenticated Ad Studio MCP server; this scaffold deliberately does not ship a second shared-token endpoint. See `docs/campaigns/CLAUDE-HANDOFF.md`.

HTTP API (personal-token clients): `/api/v1/campaigns`. Set `AD_STUDIO_API` to the selected Yoke environment’s `/api/v1` and keep `AD_STUDIO_TOKEN` in the client’s secret environment. The token belongs to a person; it is neither a platform account key nor the Supabase service key. Browser sessions use `/api/campaigns` with same-origin requests instead.

| Operation | HTTP |
|---|---|
| Defaults and capability status | GET `/campaigns/playbook` |
| Shared campaigns | GET `/campaigns` |
| Create | POST `/campaigns` `{title, requestKey}` |
| Read memo, fingerprint, deployment plans | GET `/campaigns/<id>` |
| Commit a command | POST `/campaigns/<id>/commands` `{expectedRevision, requestKey, command}` |
| Audit/event history | GET `/campaigns/<id>/observations` or `/events` |
| Report | GET `/campaigns/<id>/report?groupBy=concept&from=YYYY-MM-DD&to=YYYY-MM-DD` |
| Closeout evidence | GET `/campaigns/<id>/closeout` |
| Due review queue (no scheduler enabled) | GET `/campaigns/due` |

`groupBy`: concept, channel, audience, version. Reports are scoped to a campaign; channel deployments are grouped underneath it. Lists return `hasMore`; do not claim complete coverage when true. Reports/due scans refuse over 500 batches/campaigns rather than return misleading truncated totals.

Commands:
```json
{"type":"save_notes","notes":"Agreed decisions and still-open questions"}
{"type":"save_brief","brief":{}}
{"type":"approve","fingerprint":"returned by campaign_get"}
{"type":"authorize_launch","fingerprint":"returned by campaign_get","personConfirmed":true}
{"type":"attempt_launch"}
{"type":"observe","observation":{}}
{"type":"import_metrics","batch":{}}
{"type":"close","note":"Evidence-based final learning memo"}
```

Empty objects above are placeholders, not valid payloads. Read `src/lib/campaigns/contracts.ts` and the brief reference for complete shapes. Imports accept no credentials or raw contact lists. Observation settings follow the same channel-plan schema as the memo. `externalActor` stays null unless supported by evidence; the actual submitter is independently recorded by the server.

MCP tools: `campaign_playbook`, `campaign_list`, `campaign_create`, `campaign_get`, `campaign_command`, `campaign_audit`, `campaign_report`, `campaign_closeout`, `campaign_due`.
