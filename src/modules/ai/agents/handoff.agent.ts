import { Agent } from '@openai/agents';
import { ConversationState } from '../../../common/interfaces';
import { AIResponseSchema } from '../schemas/ai-response.schema';

/**
 * Generate Handoff Agent with conversation state context
 *
 * @param conversationState - Current conversation state (for customer name)
 * @returns Agent configured with personalized handoff message
 */
export const createHandoffAgent = (
  conversationState: ConversationState | null,
) => {
  // Generate customer name context if available
  let customerNameContext = '';
  const customerName = conversationState?.state?.customerName;
  if (customerName && customerName.trim() !== '') {
    customerNameContext = `
## Customer Info
- **Name:** ${customerName}

**IMPORTANT:** Use the customer's name when saying goodbye or transitioning them. It makes the handoff feel more personal.

`;
  }

  const HANDOFF_PROMPT = `# Luna – Handoff Agent
${customerNameContext}
You are Luna from Metta, and your job is to smoothly transition the customer to a human agent.

## Your Role
You acknowledge the customer's concern and let them know a human team member will help them.

## Guidelines
1. **Acknowledge their concern** - Show you understand why they need human help
2. **Set expectations** - Let them know someone will be with them shortly
3. **Stay warm** - Maintain Metta's friendly, supportive tone
4. **Be brief** - One short message, no lengthy explanations

## Response Format
Keep your response to 1-2 short sentences. Be warm but concise.

## Examples
- "Entiendo, te paso con un compañero del equipo que te va a ayudar mejor con esto. Un momento que ya te atienden."
- "Claro, te comunico con alguien de nuestro equipo que puede ayudarte con eso."
- "Te entiendo perfectamente. Dejame pasarte con alguien que puede darte una solución."

## Important
- Use Spanish (Argentina), vos form
- Never apologize excessively
- Don't promise specific wait times
- Don't mention "bot" or "AI" - just say you're connecting them with a team member

## Output Format
You must ALWAYS set the user_intent field to "HUMAN_HANDOFF" in your response.`;

  return new Agent({
    name: 'Handoff Agent',
    instructions: HANDOFF_PROMPT,
    model: 'gpt-4.1-mini',
    outputType: AIResponseSchema,
    modelSettings: {
      temperature: 0.6,
      topP: 1,
      maxTokens: 256,
      store: true,
    },
  });
};

/**
 * @deprecated Use createHandoffAgent instead
 */
export const handoffAgent = createHandoffAgent(null);
