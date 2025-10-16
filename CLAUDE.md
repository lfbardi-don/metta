# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Metta is a customer service AI agent built with NestJS and OpenAI Agents SDK (@openai/agents). It processes Chatwoot messages through AWS SQS, validates them with guardrails, processes them with an AI agent that has access to Odoo tools, and sends responses back to Chatwoot. All interactions are logged to Neon PostgreSQL for audit purposes only (not used as context).

## Commands

### Development
```bash
pnpm install              # Install dependencies
pnpm run start:dev        # Run in watch mode
pnpm run start:debug      # Run with debugger
pnpm run build            # Build the project
```

### Database (Prisma)
```bash
npx prisma generate                    # Generate Prisma client (run after schema changes)
npx prisma migrate dev --name <name>   # Create and apply migration
npx prisma studio                      # Open database GUI
```

### Testing
```bash
pnpm run test             # Run unit tests
pnpm run test:watch       # Run tests in watch mode
pnpm run test:cov         # Run tests with coverage
pnpm run test:e2e         # Run end-to-end tests
```

### Code Quality
```bash
pnpm run lint             # Lint and auto-fix
pnpm run format           # Format code with Prettier
```

## Architecture

### Module Dependency Graph
```
AppModule
├── PersistenceModule (@Global) - Available to all modules
├── GuardrailsModule - Standalone validation
├── IntegrationsModule
│   ├── ChatwootService - Webhook receiver + API client
│   └── OdooService - Tools for AI agent
├── QueueModule - SQS message processing
└── AIModule
    ├── imports GuardrailsModule
    └── imports IntegrationsModule (for OdooService)
```

### Message Flow
Chatwoot Webhook → SQS Queue → Integrations → Guardrails (input) → AI Agent (+ Odoo tools) → Guardrails (output) → Chatwoot API

Persistence observes all steps for audit logging but doesn't participate in the flow.

### Key Architectural Patterns

**PersistenceModule is @Global**: It's available everywhere without explicit imports. Other modules can inject `PersistenceService` or `PrismaService` directly.

**Guardrails are bidirectional**: Input validation happens before AI processing, output validation happens before sending to Chatwoot. Both use the same `GuardrailsService`.

**OdooService methods become AI tools**: Methods like `getProduct()`, `searchProducts()`, `getOrder()` are converted to tool definitions that the OpenAI agent can call. See `AIService.createOdooTools()` for implementation (TODO).

**Database is audit-only**: Messages saved to Neon PostgreSQL are for compliance/debugging, never retrieved as context for the AI agent.

**Single AI Agent**: The entire system uses one OpenAI agent (`customerServiceAgent` in `AIService`) with all Odoo tools registered. No agent handoffs.

## Module Implementation Status

All modules have boilerplate structure with method signatures. Services throw "Not implemented" errors.

**Implementation priority:**
1. PersistenceModule - Run migrations, implement save methods
2. GuardrailsModule - PII detection, toxicity, prompt injection
3. IntegrationsModule (Chatwoot) - API client with axios
4. IntegrationsModule (Odoo) - XML-RPC client
5. AIModule - Convert Odoo methods to tool format for @openai/agents
6. QueueModule - SQS client and message processor

## Shared Interfaces

All type contracts are in `src/common/interfaces/`:
- `message.interface.ts` - IncomingMessage, OutgoingMessage, MessageContext
- `odoo.interface.ts` - OdooProduct, OdooOrder, OdooCustomer
- `queue.interface.ts` - QueueMessage, QueueConfig
- `guardrail.interface.ts` - GuardrailCheck, GuardrailResult

## OpenAI Agents SDK Usage

The project uses `@openai/agents` v0.1.9 (NOT the OpenAI API directly). Tools are defined in this format:

```typescript
{
  type: 'function',
  function: {
    name: 'getProduct',
    description: 'Get product details from Odoo by product ID',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'number', description: 'The Odoo product ID' }
      },
      required: ['productId']
    },
    function: async (args) => await odooService.getProduct(args.productId)
  }
}
```

Register tools during agent initialization in `AIService.onModuleInit()`.

## Environment Setup

Copy `.env.example` to `.env` and configure:
- `OPENAI_API_KEY` - Required for AI agent
- `DATABASE_URL` - Neon PostgreSQL connection string (required for Prisma)
- `AWS_*` and `SQS_*` - AWS credentials and queue URL
- `CHATWOOT_*` - API credentials and webhook secret
- `ODOO_*` - ERP system credentials
- `GUARDRAILS_*` - Toggle validation checks

## Important Implementation Notes

When implementing `AIService.createOdooTools()`, each OdooService method needs:
1. Tool name matching the method name
2. Clear description for the AI agent
3. JSON schema for parameters
4. Function wrapper that calls the OdooService method

When implementing guardrails, each validator returns a `GuardrailCheck` with `type`, `passed`, optional `message`, and optional `score`.

When implementing Chatwoot webhook handler, POST endpoint is at `/webhooks/chatwoot` (defined in `ChatwootController`).

See `ARCHITECTURE.md` for detailed module responsibilities and `PROJECT_STRUCTURE.md` for complete file structure.
