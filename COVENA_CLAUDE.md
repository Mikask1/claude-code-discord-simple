# Covena Monorepo Index

This is a monorepo workspace for the Eden AI platform. Use this file to orient yourself before working in any sub-project.

---

## Project Map

### Backends

| Directory | What it is |
|-----------|-----------|
| `eden-portal-be` | **Main CRM/Sales backend.** Node.js/TS, Express, MongoDB, Socket.IO. Handles omnichannel messaging (WhatsApp, Instagram, Zendesk), automation engine (4 modes: Inactive/Outreach/Reminder/Signal), Auth0 + JWT auth, billing (Xendit), multi-tenancy. Has its own detailed `CLAUDE.md`. Runtime: `npm run dev`. |
| `eden-flow-experimental` | **AI orchestration backend.** Node.js/TS. Runs a multi-agent LangGraph pipeline (7 agents). Receives user messages, routes by `x-project` header, supports streaming (SSE) and non-streaming. This is the "brain" that calls eden-flow-tools. Runtime: `npm run dev`. |
| `eden-flow-tools` | **Tool execution microservice.** Bun runtime, Express. Routes `/call-tool/{client}/{tool}` to client-specific tool implementations (Garuda, Colearn, Alva, etc.). Tools are LangChain `tool()` functions, dynamically configured via MongoDB schema overrides. Has its own detailed `CLAUDE.md`. Runtime: `bun run dev`, port 3001. |
| `eden-flow-eval` | **AI evaluation service.** Python/FastAPI + Gunicorn. Postgres (SQLAlchemy + Alembic) + MongoDB. Used for evaluating/benchmarking agent outputs. Runtime: `bun dev` (wraps uvicorn). |

### Frontends

| Directory | What it is |
|-----------|-----------|
| `eden-portal-fe` | **Main CRM frontend.** Next.js app. Pages: channels, contacts, automations, billing, analytics, ai-playground, cart-details-schema, etc. The internal dashboard used by sales agents. |
| `eden-garden-hub-fe` | **Customer-facing hub frontend.** Next.js. Has per-environment config overrides (`overrides.json`, `prd-overrides.json`). Likely the public-facing chatbot/portal UI. Dockerized. |

### Infra / Config

| Directory | What it is |
|-----------|-----------|
| `eden-iac` | **Infrastructure as Code (primary).** Terraform managing AWS (ECS, ECR, App Runner, Lambda, VPC, IAM, secrets, DNS, CloudTrail) and GCP (Cloud Run, Artifact Registry). Also has `buildspec.yml` for CodeBuild. |
| `eden-prompts-hub` | **Centralized prompt management.** JSON prompt files for all clients and all agent roles (orchestrator, action, instruction, output, router, escalation, faq). Consumed by eden-flow-experimental at runtime. |

### Tools / Misc

| Directory | What it is |
|-----------|-----------|
| `claude-code-discord` | **Discord bot using Claude Agent SDK.** Bun. Per-channel persistent Claude Code sessions with full tool access. Configured via `.env`. Runtime: `bun start`. |
| `assume` | **AWS credential helper.** Python script (`assume.py`) for assuming IAM roles. |

---

## System Architecture (High Level)

```
User (WhatsApp/Instagram/Web)
        |
        v
eden-portal-be  <------>  eden-portal-fe (CRM dashboard)
        |
        v
eden-flow-experimental  (LangGraph pipeline)
        |
        v
eden-flow-tools  (tool execution: /call-tool/{client}/{tool})
        |
        v
External APIs (Garuda, Xendit, Google Sheets, Qdrant, etc.)
```

Prompts for eden-flow-experimental agents live in `eden-prompts-hub`.
All infra is managed in `eden-iac`.

---

# Instructions
When changing code:
- Always git pull --rebase whenever you're starting a new session.
- Always use git worktrees.
- Author: Covena-Discord-Bot
