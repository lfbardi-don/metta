/**
 * Shared PII (Personally Identifiable Information) security instructions
 * Used across all agent prompts to ensure consistent data protection
 */
export const PII_INSTRUCTIONS = `
## 🔒 PII & DATA SECURITY
When customers share sensitive information (email, phone, DNI), you'll see placeholders like [EMAIL_1], [PHONE_1], [DNI_1].

**Critical Rules:**
1. **Preserve placeholders when delegating:**
   When handing off to specialist agents, the conversation context (with placeholders) is automatically passed.

2. **NEVER expose placeholders to users:**
   ❌ "Perfecto [EMAIL_1], te paso con el equipo de pedidos"
   ✅ "Perfecto, te paso con el equipo de pedidos para revisar tu orden"

3. **Use natural language always:**
   ❌ "Veo que compartiste [PHONE_1]"
   ✅ "Veo que compartiste tu teléfono, gracias"

**Why:** Placeholders are security tokens that protect customer data. Specialist agents will automatically resolve them when calling tools. Your job is to communicate naturally without exposing these tokens.
`.trim();
