# Project Structure

## 📁 Directory Tree

```
metta/
├── prisma/
│   └── schema.prisma                           # Database schema (Neon PostgreSQL)
│
├── src/
│   ├── common/
│   │   └── interfaces/                         # Shared type definitions
│   │       ├── chatwoot-webhook.interface.ts   # Webhook payload from Lambda/SQS
│   │       ├── guardrail.interface.ts          # Guardrail validation types
│   │       ├── message.interface.ts            # Message types + fromChatwootWebhook() helper
│   │       ├── odoo.interface.ts               # Odoo data types (products/orders)
│   │       ├── queue.interface.ts              # SQS configuration types
│   │       └── index.ts                        # Barrel export
│   │
│   ├── modules/
│   │   ├── queue/                              # 🚀 ENTRY POINT - AWS SQS Consumer
│   │   │   ├── queue.module.ts                 # Module definition
│   │   │   ├── queue.service.ts                # SQS client (poll, delete, parse)
│   │   │   └── queue.processor.ts              # Main processing loop (auto-starts)
│   │   │
│   │   ├── ai/                                 # 🤖 AI Agent Module
│   │   │   ├── prompts/
│   │   │   │   └── index.ts                    # Agent instructions
│   │   │   ├── ai.controller.ts                # API endpoints for testing
│   │   │   ├── ai.module.ts                    # Module definition
│   │   │   └── ai.service.ts                   # Agent orchestration + tool integration
│   │   │
│   │   ├── guardrails/                         # 🛡️ Validation Module
│   │   │   ├── guardrails.module.ts
│   │   │   └── guardrails.service.ts           # Input/output validation
│   │   │
│   │   ├── integrations/                       # 🔌 External Services
│   │   │   ├── chatwoot/                       # Messaging platform
│   │   │   │   ├── chatwoot.controller.ts      # Test endpoints (NOT prod webhooks)
│   │   │   │   └── chatwoot.service.ts         # API client (SEND only)
│   │   │   ├── odoo/                           # ERP system
│   │   │   │   └── odoo.service.ts             # Tools for AI agent
│   │   │   └── integrations.module.ts
│   │   │
│   │   └── persistence/                        # 💾 Database Module
│   │       ├── persistence.module.ts           # @Global module
│   │       ├── persistence.service.ts          # Save messages/metadata (audit only)
│   │       └── prisma.service.ts               # Prisma client
│   │
│   ├── app.module.ts                           # Main application module
│   └── main.ts                                 # Application entry point + graceful shutdown
│
├── .env.example                                # Environment variables template
├── ARCHITECTURE.md                             # Architecture documentation (UPDATED)
├── CLAUDE.md                                   # Claude Code guidance (UPDATED)
├── PROJECT_STRUCTURE.md                        # This file (UPDATED)
├── package.json                                # Dependencies
└── tsconfig.json                               # TypeScript configuration
```

## 📊 Module Overview

| Module | Purpose | Type | Status |
|--------|---------|------|--------|
| **QueueModule** ⭐ | AWS SQS consumer (ENTRY POINT) | Worker | ✅ Boilerplate ready |
| **IntegrationsModule** | Chatwoot (send) + Odoo (tools) | Integration | ✅ Boilerplate ready |
| **GuardrailsModule** | Input/output validation | Validation | ✅ Boilerplate ready |
| **AIModule** | OpenAI agent orchestration | Processing | ✅ Boilerplate ready |
| **PersistenceModule** | Audit logging to database | Database (@Global) | ✅ Boilerplate ready |

## 🔗 Module Connections

```
AppModule (Worker Application)
  ↓
  ├─► PersistenceModule (@Global)
  │     Available to all modules for audit logging
  │
  ├─► GuardrailsModule
  │     Standalone validation service
  │
  ├─► IntegrationsModule
  │     ├─► ChatwootService (send messages via API)
  │     └─► OdooService (tools for AI agent)
  │
  ├─► QueueModule ⭐ ENTRY POINT
  │     └─► Auto-starts on module init
  │           Polls SQS continuously
  │
  └─► AIModule
        ├─► GuardrailsService (validation)
        └─► OdooService (tools)
```

## 📋 Files Created/Updated

### Core Interfaces (6 files) ✅
- ✅ `src/common/interfaces/chatwoot-webhook.interface.ts` **NEW**
- ✅ `src/common/interfaces/message.interface.ts` (updated with helper)
- ✅ `src/common/interfaces/odoo.interface.ts`
- ✅ `src/common/interfaces/queue.interface.ts` (updated for SQS)
- ✅ `src/common/interfaces/guardrail.interface.ts`
- ✅ `src/common/interfaces/index.ts` (updated exports)

### Queue Module (3 files) ✅ **UPDATED**
- ✅ `src/modules/queue/queue.module.ts` (updated docs)
- ✅ `src/modules/queue/queue.service.ts` **REWRITTEN** - Full SQS implementation
- ✅ `src/modules/queue/queue.processor.ts` **REWRITTEN** - Complete processing loop

### Integrations Module (4 files) ✅ **UPDATED**
- ✅ `src/modules/integrations/integrations.module.ts` (updated docs)
- ✅ `src/modules/integrations/chatwoot/chatwoot.service.ts` (no changes)
- ✅ `src/modules/integrations/chatwoot/chatwoot.controller.ts` **UPDATED** - Test endpoints only
- ✅ `src/modules/integrations/odoo/odoo.service.ts` (no changes)

### Guardrails Module (2 files) ✅
- ✅ `src/modules/guardrails/guardrails.module.ts`
- ✅ `src/modules/guardrails/guardrails.service.ts`

### Persistence Module (4 files) ✅
- ✅ `src/modules/persistence/persistence.module.ts`
- ✅ `src/modules/persistence/persistence.service.ts`
- ✅ `src/modules/persistence/prisma.service.ts`
- ✅ `prisma/schema.prisma`

### AI Module (2 files) ✅
- ✅ `src/modules/ai/ai.module.ts` (already had dependencies)
- ✅ `src/modules/ai/ai.service.ts` (already had integrations)

### Configuration (4 files) ✅ **UPDATED**
- ✅ `src/app.module.ts` **UPDATED** - Worker architecture docs
- ✅ `src/main.ts` **UPDATED** - Graceful shutdown handlers
- ✅ `.env.example` **UPDATED** - Worker configs added
- ✅ `ARCHITECTURE.md` **COMPLETELY REWRITTEN** - Worker pattern
- ✅ `CLAUDE.md` **COMPLETELY REWRITTEN** - Worker guidance
- ✅ `PROJECT_STRUCTURE.md` **THIS FILE** - Updated structure

## 🎯 Key Changes from Original Boilerplate

### ❌ Removed/Changed:
1. **ChatwootController webhook endpoint** → Now optional test endpoint only (`/test/chatwoot/*`)
2. **QueueMessage generic interface** → Replaced with SQS-specific types
3. **QueueService.sendMessage()** → Removed (we only consume, not send to SQS)
4. **Webhook-first architecture** → Changed to Worker-first architecture

### ✅ Added/Updated:
1. **ChatwootWebhookPayload interface** - Structure from Lambda
2. **SQSMessagePayload interface** - AWS SQS message structure
3. **fromChatwootWebhook() helper** - Convert webhook to IncomingMessage
4. **QueueService** - Full SQS consumer implementation with long polling
5. **QueueProcessor** - Complete processing loop with auto-start
6. **Graceful shutdown** - SIGTERM/SIGINT handlers in main.ts
7. **Worker configs** - WORKER_ENABLED, SQS polling settings
8. **Complete documentation** - Worker pattern explained everywhere

## 🚀 Next Steps

### 1. Install Dependencies
```bash
pnpm add @nestjs/config @aws-sdk/client-sqs @prisma/client axios
pnpm add -D prisma
```

### 2. Set Up Database
```bash
cp .env.example .env
# Fill in DATABASE_URL
npx prisma generate
npx prisma migrate dev --name init
```

### 3. Test Queue Module (Priority #1)
```bash
# Configure AWS credentials in .env
# Start worker
pnpm run start:dev

# Check logs:
# - "Queue service initialized"
# - "Started processing messages from queue"

# Send test message to SQS (via AWS Console or CLI)
# Verify worker receives and logs it
```

### 4. Implement Modules (Incremental Order)
1. **QueueModule** - Verify SQS connection works
2. **ChatwootService** - Implement sendMessage() with axios
3. **AIModule** - Test agent without tools
4. **GuardrailsModule** - Add validation
5. **OdooService** - Add tools
6. **PersistenceModule** - Add audit logging

## 📝 Key Files to Check

- **Architecture Overview:** `ARCHITECTURE.md` - Complete system design
- **Claude Guidance:** `CLAUDE.md` - How to work with this codebase
- **Environment Config:** `.env.example` - All required variables
- **Database Schema:** `prisma/schema.prisma` - Audit log structure
- **Entry Point:** `src/modules/queue/queue.processor.ts` - Where processing starts
- **Message Flow:** `src/common/interfaces/message.interface.ts` - Data transformations

## 🎯 Current Status

**BOILERPLATE COMPLETE** ✅

Worker architecture fully implemented:
- QueueModule with SQS consumer (auto-starts)
- Full message processing loop
- Graceful shutdown handling
- Message filtering (incoming only)
- Integration points prepared
- Documentation updated

**Architecture type:** AWS SQS Worker (NOT API server)
**Entry point:** QueueModule (auto-starts on init)
**HTTP server:** Only for health checks and test endpoints

**Ready for implementation!** Start with testing Queue Module, then add features incrementally.
