# Knowledge Base Service

A simple, in-memory knowledge base service that provides FAQs, policies, and business information to the AI agent through tools.

## Why Knowledge Base Tools Instead of RAG?

For small, static datasets (1-5 pages), tools are superior to RAG because:
- ✅ Simpler implementation (no vector database, embeddings, or retrieval complexity)
- ✅ Explicit retrieval (AI explicitly calls tools when needed)
- ✅ Reduces prompt token usage (info not embedded in system prompt)
- ✅ Easy to maintain (just edit the TypeScript file)
- ✅ Zero infrastructure cost (no vector DB required)

## How It Works

The AI agent has access to three knowledge base tools:

1. **search_knowledge_base** - Searches FAQs and policies by keyword/topic
2. **get_policy** - Retrieves full text of specific policies
3. **get_business_info** - Gets store contact details, hours, and social media

When a user asks a question like "What is your return policy?", the AI agent:
1. Recognizes it needs policy information
2. Calls `search_knowledge_base` or `get_policy` tool
3. Receives the relevant content
4. Formulates a natural response using that information

## Customizing Your Knowledge Base

Edit `knowledge.service.ts` to replace the example data with your actual store information:

### 1. Update FAQs

Replace the example FAQs in the `faqs` array (lines 26-63):

```typescript
private readonly faqs: FAQ[] = [
  {
    id: 'faq-1',
    question: 'What is your return policy?',
    answer: 'We accept returns within 30 days...',
    category: 'returns',
    keywords: ['return', 'refund', 'exchange'],
  },
  // Add more FAQs here
];
```

**Tips:**
- Use clear, customer-facing questions
- Provide complete answers (but keep them concise)
- Add relevant keywords for better search matching
- Choose appropriate categories: `'general'`, `'faq'`, `'sizing'`, `'shipping'`, `'returns'`, `'product_care'`, `'payments'`, `'orders'`

### 2. Update Policies

Replace the example policies in the `policies` array (lines 65-167):

```typescript
private readonly policies: Policy[] = [
  {
    id: 'policy-shipping',
    type: 'shipping',
    title: 'Shipping Policy',
    content: `Your full shipping policy text here...`,
    lastUpdated: new Date('2025-01-15'),
  },
  // Add more policies here
];
```

**Available Policy Types:**
- `'shipping'` - Shipping rates, delivery times, tracking
- `'returns'` - Return windows, conditions, process
- `'warranty'` - Product warranties and guarantees
- `'privacy'` - Privacy policy and data handling
- `'terms_of_service'` - Terms and conditions
- `'refund'` - Refund process and timelines

### 3. Update Business Information

Replace the example business info in the `businessInfo` object (lines 169-201):

```typescript
private readonly businessInfo: BusinessInfo = {
  name: 'Your Store Name',
  description: 'Premium quality products...',
  contact: {
    email: 'support@yourstore.com',
    phone: '+1 (555) 123-4567',
    whatsapp: '+1 (555) 123-4567',
  },
  address: {
    street: '123 Main Street',
    city: 'New York',
    state: 'NY',
    country: 'USA',
    postalCode: '10001',
  },
  businessHours: {
    monday: '9:00 AM - 6:00 PM EST',
    // ... other days
  },
  socialMedia: {
    instagram: '@yourstore',
    facebook: 'facebook.com/yourstore',
  },
};
```

## Adding New Categories or Policy Types

If you need additional categories or policy types, update the type definitions in `knowledge.interface.ts`:

```typescript
export type KnowledgeCategory =
  | 'general'
  | 'faq'
  | 'sizing'
  | 'your_new_category'; // Add here

export type PolicyType =
  | 'shipping'
  | 'returns'
  | 'your_new_policy_type'; // Add here
```

## Scaling to Larger Datasets

If your knowledge base grows beyond ~20-30 pages, consider:

1. **File-based storage** - Move data to JSON files and load on startup
2. **Database storage** - Store in PostgreSQL with full-text search
3. **RAG implementation** - Add vector embeddings and semantic search for very large datasets (100+ pages)

For now, the in-memory approach is perfect for your use case (small, static data).

## Testing Your Knowledge Base

After updating the data, restart the worker and test with example questions:

```bash
# Restart worker
pnpm run start:dev

# Test questions to try:
# - "What is your return policy?"
# - "How long does shipping take?"
# - "What are your business hours?"
# - "How can I contact you?"
# - "Do you ship internationally?"
```

Watch the logs to see when the AI agent calls the knowledge tools.

## Architecture

```
User Question
    ↓
Triage Agent (has knowledge tools)
    ↓
Calls search_knowledge_base or get_policy tool
    ↓
KnowledgeService.search() or getPolicy()
    ↓
Returns matching FAQs/policies
    ↓
AI formulates natural response
    ↓
Response sent to user
```

The knowledge tools are assigned to the **Triage Agent** because it handles general store questions and FAQs before routing to specialist agents (Products, Orders).
