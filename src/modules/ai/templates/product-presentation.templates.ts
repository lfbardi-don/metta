/**
 * Product Presentation Templates
 *
 * Defines different presentation formats for products based on conversation context.
 * Used by ProductPresentationService to generate context-aware instructions.
 */

export type PresentationMode = 'FULL_CARD' | 'SIZE_ONLY' | 'COMPACT' | 'TEXT_ONLY';

/**
 * FULL_CARD - Complete product presentation
 * Used for: Initial search, explicit re-show requests, products not recently mentioned
 */
export const FULL_CARD_INSTRUCTIONS = `
**PRESENTATION MODE: FULL_CARD**

Show complete product cards with all details.

Format each product as:
![{product.name}]({product.imageUrl})
**{PRODUCT NAME IN CAPS}**
Precio: {price with $ and thousands separator} | Disponible
Descripción: {brief description}

---

Rules:
- Always include image if available
- Show price with $ and thousands separator (e.g., $55,000)
- NEVER reveal exact stock quantities, only availability status
- Show maximum 3 products
- Use proper markdown formatting
`;

/**
 * SIZE_ONLY - Size availability response
 * Used for: Size queries about recently mentioned products
 */
export const SIZE_ONLY_INSTRUCTIONS = `
**PRESENTATION MODE: SIZE_ONLY**

The user is asking about size availability for a product that was recently shown.

DO NOT show the full product card again. DO NOT show images.

Response format:
\`\`\`
El {productName} está disponible en talle {requestedSize}.
Talles disponibles: {comma-separated list of all available sizes}
\`\`\`

If size is NOT available:
\`\`\`
El {productName} no está disponible en talle {requestedSize}.
Talles disponibles: {comma-separated list of available sizes}
\`\`\`

Rules:
- Include product name for reference
- Give direct yes/no answer for requested size
- Always list all available sizes
- Do NOT show price, image, or full description
- Do NOT repeat information already shown
`;

/**
 * COMPACT - Brief product reference
 * Used for: Comparisons, multiple product discussions
 */
export const COMPACT_INSTRUCTIONS = `
**PRESENTATION MODE: COMPACT**

The user is comparing or discussing multiple products that were recently shown.

**CRITICAL - YOU MUST CALL MCP TOOLS FIRST:**
Even though these products were recently shown, you MUST call MCP tools to get current product data.
Use get_nuvemshop_product({productId}) for each product being discussed.
The Product IDs are provided in the "Products Being Discussed" section below.

After getting fresh data from MCP tools, present results in compact format (DO NOT show full cards or images):

**{PRODUCT NAME IN CAPS}**: Precio {price with $} - {key distinguishing feature or answer to question}

Rules:
- ALWAYS call get_nuvemshop_product() with the Product IDs from the conversation state
- After getting tool results, format as one line per product
- Include product name and current price
- Focus on the specific comparison or difference being asked
- Do NOT show images
- Do NOT repeat full product descriptions
- Be concise and direct in answering the comparison question
`;

/**
 * TEXT_ONLY - Direct textual answer
 * Used for: Specific attribute queries (color, material, etc.)
 */
export const TEXT_ONLY_INSTRUCTIONS = `
**PRESENTATION MODE: TEXT_ONLY**

The user is asking a specific question about a product attribute.

DO NOT show product cards. DO NOT show images. DO NOT re-list product details.

Provide a direct textual answer to the question.

Format:
\`\`\`
{Direct answer to the user's question}
\`\`\`

Example questions and responses:
- "El TINI viene en negro?" → "Sí, el TINI está disponible en color negro también."
- "De qué material es el ZIRI?" → "El ZIRI está hecho de denim con 2% elastano."

Rules:
- Answer the question directly
- Reference the product by name
- Do NOT show price, image, or full description
- Keep response concise
- Only provide the information being asked for
`;

/**
 * Get instructions for a specific presentation mode
 */
export function getPresentationInstructions(mode: PresentationMode): string {
  switch (mode) {
    case 'FULL_CARD':
      return FULL_CARD_INSTRUCTIONS;
    case 'SIZE_ONLY':
      return SIZE_ONLY_INSTRUCTIONS;
    case 'COMPACT':
      return COMPACT_INSTRUCTIONS;
    case 'TEXT_ONLY':
      return TEXT_ONLY_INSTRUCTIONS;
    default:
      return FULL_CARD_INSTRUCTIONS;
  }
}
