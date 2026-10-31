# Yoke campaign operator continuation

Read `AGENTS.md`, then `docs/campaigns/CLAUDE-HANDOFF.md` and `docs/campaigns/ACCOUNT-ACCESS.md` before continuing this build.

The product starts with a conversation, produces an approved one-page campaign memo, launches consistently after “go”, reports observed settings/performance, and closes with a learning memo at the declared analysis date.

This branch adds code structure to the existing Yoke Ad Studio. Firm accounts, real execution adapters and scheduled closeout remain unconnected. Follow the handoff’s exact integration sequence and validation; never interpret a scaffold command or imported evidence as a verified live integration.

Keep firm credentials in the chosen server’s secret store. No tokens, contact exports, private account evidence or environment files belong in this repository. Preserve parallel Ad Studio/OAuth work when reconciling branches. Do not deploy or activate account connections as a side effect of merging code.
