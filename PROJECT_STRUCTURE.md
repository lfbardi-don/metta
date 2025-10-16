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
│   │       ├── guardrail.interface.ts          # Guardrail validation types
│   │       ├── message.interface.ts            # Message types (incoming/outgoing)
│   │       ├── odoo.interface.ts               # Odoo data types (products/orders)
│   │       ├── queue.interface.ts              # Queue message types
│   │       └── index.ts                        # Barrel export
│   │
│   ├── modules/
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
│   │   │   │   ├── chatwoot.controller.ts      # Webhook endpoint
│   │   │   │   └── chatwoot.service.ts         # API client
│   │   │   ├── odoo/                           # ERP system
│   │   │   │   └── odoo.service.ts             # Tools for AI agent
│   │   │   └── integrations.module.ts
│   │   │
│   │   ├── persistence/                        # 💾 Database Module
│   │   │   ├── persistence.module.ts           # @Global module
│   │   │   ├── persistence.service.ts          # Save messages/metadata
│   │   │   └── prisma.service.ts               # Prisma client
│   │   │
│   │   └── queue/                              # 📨 SQS Queue Module
│   │       ├── queue.module.ts
│   │       ├── queue.processor.ts              # Message processing loop
│   │       └── queue.service.ts                # SQS client
│   │
│   ├── app.module.ts                           # Main application module
│   └── main.ts                                 # Application entry point
│
├── .env.example                                # Environment variables template
├── ARCHITECTURE.md                             # Architecture documentation
├── PROJECT_STRUCTURE.md                        # This file
├── package.json                                # Dependencies
└── tsconfig.json                               # TypeScript configuration
```

## 📊 Module Overview

| Module | Purpose | Dependencies | Status |
|--------|---------|--------------|--------|
| **PersistenceModule** | Audit logging to database | None (Global) | ✅ Structure ready |
| **GuardrailsModule** | Input/output validation | None | ✅ Structure ready |
| **IntegrationsModule** | Chatwoot + Odoo | None | ✅ Structure ready |
| **QueueModule** | SQS message processing | IntegrationsModule | ✅ Structure ready |
| **AIModule** | OpenAI agent orchestration | GuardrailsModule, IntegrationsModule | ✅ Structure ready |

## 🔗 Module Connections

```
AppModule
  ↓
  ├─► PersistenceModule (@Global)
  │     Available to all modules for audit logging
  │
  ├─► GuardrailsModule
  │     Standalone validation service
  │
  ├─► IntegrationsModule
  │     ├─► ChatwootService (webhooks + API)
  │     └─► OdooService (tools for AI)
  │
  ├─► QueueModule
  │     └─► [will use IntegrationsModule]
  │
  └─► AIModule
        ├─► GuardrailsService (validation)
        └─► OdooService (tools)
```

## 📋 Files Created

### Core Interfaces (5 files)
- ✅ `src/common/interfaces/message.interface.ts`
- ✅ `src/common/interfaces/odoo.interface.ts`
- ✅ `src/common/interfaces/queue.interface.ts`
- ✅ `src/common/interfaces/guardrail.interface.ts`
- ✅ `src/common/interfaces/index.ts`

### Queue Module (3 files)
- ✅ `src/modules/queue/queue.module.ts`
- ✅ `src/modules/queue/queue.service.ts`
- ✅ `src/modules/queue/queue.processor.ts`

### Integrations Module (4 files)
- ✅ `src/modules/integrations/integrations.module.ts`
- ✅ `src/modules/integrations/chatwoot/chatwoot.service.ts`
- ✅ `src/modules/integrations/chatwoot/chatwoot.controller.ts`
- ✅ `src/modules/integrations/odoo/odoo.service.ts`

### Guardrails Module (2 files)
- ✅ `src/modules/guardrails/guardrails.module.ts`
- ✅ `src/modules/guardrails/guardrails.service.ts`

### Persistence Module (4 files)
- ✅ `src/modules/persistence/persistence.module.ts`
- ✅ `src/modules/persistence/persistence.service.ts`
- ✅ `src/modules/persistence/prisma.service.ts`
- ✅ `prisma/schema.prisma`

### AI Module (Updated)
- ✅ `src/modules/ai/ai.module.ts` (updated with dependencies)
- ✅ `src/modules/ai/ai.service.ts` (updated with guardrails + tools)

### Configuration
- ✅ `src/app.module.ts` (updated with all modules)
- ✅ `.env.example` (updated with all environment variables)
- ✅ `ARCHITECTURE.md` (complete architecture documentation)
- ✅ `PROJECT_STRUCTURE.md` (this file)

## 🚀 Next Steps

### 1. Install Dependencies
```bash
pnpm add @nestjs/config @aws-sdk/client-sqs @prisma/client axios
pnpm add -D prisma
```

### 2. Set Up Database
```bash
# Copy .env.example to .env and fill in DATABASE_URL
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Create database tables
npx prisma migrate dev --name init
```

### 3. Implement Modules (Recommended Order)

#### Phase 1: Persistence
- Implement `PersistenceService` save methods
- Test database connection

#### Phase 2: Guardrails
- Implement PII detection
- Implement toxicity checking
- Implement prompt injection detection

#### Phase 3: Chatwoot Integration
- Implement Chatwoot API client (axios)
- Test webhook endpoint
- Test sending messages

#### Phase 4: Odoo Integration
- Implement Odoo XML-RPC client
- Test data fetching methods

#### Phase 5: AI Agent
- Convert Odoo methods to tools
- Test agent with tools
- Integrate with guardrails

#### Phase 6: Queue Processing
- Implement SQS client
- Implement message processor
- Set up polling/cron

## 📝 Key Files to Check

- **Architecture Overview:** `ARCHITECTURE.md`
- **Environment Config:** `.env.example`
- **Database Schema:** `prisma/schema.prisma`
- **Module Connections:** `src/app.module.ts`
- **AI Service:** `src/modules/ai/ai.service.ts` (see TODO comments)

## 🎯 Current Status

**BOILERPLATE COMPLETE** ✅

All module structures are in place with:
- Module definitions
- Service skeletons
- Method signatures
- Type interfaces
- TODO comments for implementation

**Ready to implement one module at a time!**
