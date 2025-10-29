import { Injectable, Logger } from '@nestjs/common';
import {
  FAQ,
  Policy,
  BusinessInfo,
  KnowledgeCategory,
  PolicyType,
  KnowledgeSearchResult,
  PolicyResult,
  BusinessInfoResult,
} from './knowledge.interface';

/**
 * Knowledge Base Service
 *
 * Provides FAQs, policies, and business information for the AI agent.
 * This is a simple in-memory implementation - replace with database or CMS if needed.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  // Knowledge base de Metta - Información real de la marca
  private readonly faqs: FAQ[] = [
    {
      id: 'faq-1',
      question: '¿Qué talles tienen?',
      answer:
        'Tenemos una amplia variedad de talles reales para que cada mujer encuentre su calce perfecto:\n\n• **Jeans:** Talle 30 al 52 (también disponemos de talles más grandes según demanda)\n• **Remeras y prendas superiores:** XS a XL\n\nNuestra marca nace para acompañar a cada mujer con talles que se adapten a su cuerpo real. Contamos con una guía de talles completa con medidas exactas de cintura, cadera y busto para ayudarte a elegir correctamente. Si tenés dudas sobre tu talle, preguntame por las medidas específicas o cómo medirte correctamente.',
      category: 'sizing',
      keywords: ['talles', 'tallas', 'medidas', 'talle', 'size', '34', '50', 'guía de talles', 'variedad', 'XS', 'XL'],
    },
    {
      id: 'faq-2',
      question: '¿Hacen envíos gratis?',
      answer:
        'Sí, hacemos envíos gratis para compras superiores a $120.000. Para montos menores, el costo del envío se calcula según tu ubicación.',
      category: 'shipping',
      keywords: ['envío', 'envíos', 'gratis', 'shipping', 'delivery', '120000', 'costo'],
    },
    {
      id: 'faq-3',
      question: '¿Qué modelos de jeans tienen?',
      answer:
        'Tenemos varios modelos de jeans: mom, straight, wide leg, baggy, entre otros. Cada modelo está diseñado para adaptarse a diferentes tipos de cuerpo y estilos. Podés ver todos los modelos disponibles en nuestra tienda online.',
      category: 'product_care',
      keywords: ['modelos', 'mom', 'straight', 'wide leg', 'baggy', 'tipos', 'estilos'],
    },
    {
      id: 'faq-4',
      question: '¿Cómo puedo pagar?',
      answer:
        'Aceptamos pagos en 6 cuotas sin interés con tarjeta de crédito. También ofrecemos un 10% de descuento si pagás por transferencia o depósito bancario.',
      category: 'payments',
      keywords: ['pago', 'pagos', 'cuotas', 'transferencia', 'descuento', '10%', '6 cuotas', 'tarjeta'],
    },
    {
      id: 'faq-5',
      question: '¿Tienen local físico o showroom?',
      answer:
        'Sí, tenemos showroom en el Edificio KM41 – Oficina 308, Colectora Sur Acceso Oeste Km 41, Francisco Álvarez, Provincia de Buenos Aires. Podés visitarnos para ver y probar nuestras prendas.',
      category: 'general',
      keywords: ['showroom', 'local', 'físico', 'tienda', 'ubicación', 'dirección', 'km41'],
    },
    {
      id: 'faq-6',
      question: '¿Qué hace especial a Metta?',
      answer:
        'Somos una marca de ropa de mujer que nace para acompañarte en tu búsqueda de prendas que se sientan bien, que duren y que se adapten a tu cuerpo real. Nuestros diferenciales son: amplia variedad de talles reales (del 34 al 50), calidad accesible, diseño atemporal, y varios modelos para que cada cuerpo encuentre su jean perfecto.',
      category: 'general',
      keywords: ['marca', 'diferencial', 'calidad', 'especial', 'valores', 'quiénes somos'],
    },
    {
      id: 'faq-7',
      question: '¿Hacen cambios o devoluciones?',
      answer:
        'Sí, tenemos una política de cambios y devoluciones accesible. Podés gestionar tu cambio o devolución directamente desde nuestra web. Queremos que encuentres el jean que te quede perfecto.',
      category: 'returns',
      keywords: ['cambio', 'cambios', 'devolución', 'devoluciones', 'devolver', 'return'],
    },
    {
      id: 'faq-8',
      question: '¿Solo venden jeans?',
      answer:
        'Nuestro producto principal son los jeans, pero cada temporada incorporamos nuevas líneas como remeras de hilo tejido, pantalones sastreros y pantalones de gabardina. Todas nuestras prendas mantienen la misma filosofía: calidad, diseño y talles reales.',
      category: 'general',
      keywords: ['productos', 'remeras', 'pantalones', 'sastreros', 'gabardina', 'temporada'],
    },
    {
      id: 'faq-9',
      question: '¿Cómo sé qué talle elegir?',
      answer:
        'Sabemos lo difícil que es encontrar un jean que te quede bien. Por eso tenemos una guía de talles disponible en nuestra web. También podés contactarnos y te ayudamos a encontrar tu talle ideal según tus medidas y el modelo que te interesa.',
      category: 'sizing',
      keywords: ['elegir talle', 'qué talle', 'medidas', 'guía', 'ayuda', 'asesoramiento'],
    },
    {
      id: 'faq-10',
      question: '¿Cuál es la calidad de los jeans?',
      answer:
        'Trabajamos con materiales de calidad y un buen calce, diseñados para ajustarse al cuerpo real. Nuestros jeans están pensados para que duren, con una relación calidad-precio justa. No seguimos tendencias pasajeras, sino que creamos prendas versátiles y atemporales.',
      category: 'product_care',
      keywords: ['calidad', 'materiales', 'duración', 'precio', 'durable'],
    },
    {
      id: 'faq-11',
      question: '¿Cuáles son las medidas exactas de cada talle de jeans?',
      answer: `
**GUÍA DE TALLES - JEANS/DENIM (Medidas en cm):**

• **Talle 30:** Cintura 54-58cm, Cadera 80-84cm
• **Talle 32:** Cintura 58-62cm, Cadera 84-88cm
• **Talle 34:** Cintura 62-66cm, Cadera 88-92cm
• **Talle 36:** Cintura 66-70cm, Cadera 92-96cm
• **Talle 38:** Cintura 70-74cm, Cadera 96-100cm
• **Talle 40:** Cintura 74-78cm, Cadera 100-104cm
• **Talle 42:** Cintura 78-82cm, Cadera 104-108cm
• **Talle 44:** Cintura 82-86cm, Cadera 108-112cm
• **Talle 46:** Cintura 86-90cm, Cadera 112-116cm
• **Talle 48:** Cintura 90-94cm, Cadera 116-120cm
• **Talle 50:** Cintura 94-98cm, Cadera 120-124cm
• **Talle 52:** Cintura 98-102cm, Cadera 124-130cm

Para saber tu talle ideal, medite la cintura y cadera y comparalas con esta tabla. Si estás entre dos talles, te recomendamos elegir el más grande para mayor comodidad.
      `.trim(),
      category: 'sizing',
      keywords: ['medidas', 'talle jean', 'cintura', 'cadera', 'guía de talles jeans', 'centímetros', '30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', 'tabla de medidas'],
    },
    {
      id: 'faq-12',
      question: '¿Cuáles son las medidas de las remeras y prendas superiores?',
      answer: `
**GUÍA DE TALLES - PRENDAS SUPERIORES (Remeras, Blusas) (Medidas en cm):**

• **Talle XS:** Busto 78-81cm, Cintura 58-61cm
• **Talle S:** Busto 82-89cm, Cintura 62-69cm
• **Talle M:** Busto 90-97cm, Cintura 70-77cm
• **Talle L:** Busto 98-105cm, Cintura 78-85cm
• **Talle XL:** Busto 106-114cm, Cintura 86-94cm

Para saber tu talle, medite el contorno de busto y cintura y comparalas con esta tabla. Si estás entre dos talles, te recomendamos el talle más grande para mayor comodidad.
      `.trim(),
      category: 'sizing',
      keywords: ['medidas remeras', 'talle remera', 'busto', 'prendas superiores', 'XS', 'S', 'M', 'L', 'XL', 'tabla remeras', 'blusa'],
    },
    {
      id: 'faq-13',
      question: '¿Cómo me mido correctamente para elegir mi talle?',
      answer: `
**CÓMO TOMAR TUS MEDIDAS:**

**BUSTO:** Medí el contorno de pecho en la parte más saliente. Mantené el centímetro lo más alineado posible alrededor de tu cuerpo.

**CINTURA:** Medí el contorno de cintura en la parte más angosta, sin ajustar demasiado. Es la parte más fina de tu torso, generalmente a la altura del ombligo.

**CADERA:** Medí el contorno de cadera en la parte más ancha, sin ajustar demasiado. Es la parte más ancha de tus caderas y glúteos.

**CONSEJOS:**
• Usá un centímetro de costura (cinta métrica flexible)
• Medite sobre ropa interior o ropa ajustada, no sobre ropa gruesa
• Mantené el centímetro paralelo al piso
• No aprietes demasiado, debe quedar ajustado pero cómodo
• Pedile a alguien que te ayude para medidas más precisas

Una vez que tengas tus medidas, comparalas con nuestra guía de talles. Si tenés dudas, ¡contactanos y te ayudamos a elegir!
      `.trim(),
      category: 'sizing',
      keywords: ['cómo medir', 'medirse', 'tomar medidas', 'centímetro', 'cinta métrica', 'consejos', 'ayuda medidas', 'medir busto', 'medir cintura', 'medir cadera'],
    },
  ];

  private readonly policies: Policy[] = [
    {
      id: 'policy-shipping',
      type: 'shipping',
      title: 'Política de Envíos',
      content: `
**Envíos Gratis:**
- Para compras superiores a $120.000, el envío es totalmente gratis.
- Para montos menores, el costo de envío se calcula según la ubicación de destino.

**Cobertura:**
- Realizamos envíos a todo el país (Argentina).
- Los tiempos de entrega varían según la zona.

**Proceso de Envío:**
- Una vez confirmado tu pago, preparamos tu pedido.
- Recibirás un número de seguimiento para trackear tu envío.
- Podés consultar el estado de tu pedido en cualquier momento.

**Showroom/Retiro:**
- También podés retirar tu compra en nuestro showroom: Edificio KM41 – Oficina 308, Colectora Sur Acceso Oeste Km 41, Francisco Álvarez, Buenos Aires.
      `.trim(),
      lastUpdated: new Date('2025-01-29'),
    },
    {
      id: 'policy-returns',
      type: 'returns',
      title: 'Política de Cambios y Devoluciones',
      content: `
**Cambios y Devoluciones:**
En Metta, queremos que encuentres el jean que te quede perfecto. Por eso, ofrecemos una política de cambios y devoluciones accesible.

**Cómo Gestionar Cambios o Devoluciones:**
- Podés gestionar tu cambio o devolución directamente desde nuestra web.
- Contactanos por WhatsApp (+54 9 11 3902-2938) o email (hola@metta.com.ar) con tu número de pedido.
- Nuestro equipo te guiará en el proceso.

**Condiciones:**
- Las prendas deben estar sin usar, con etiquetas originales.
- Es importante que la prenda esté en perfectas condiciones para el cambio.

**Guía de Talles:**
- Contamos con una guía de talles completa en nuestra web para ayudarte a elegir correctamente.
- Si tenés dudas sobre tu talle, contactanos antes de comprar para asesorarte.

**Objetivo:**
Queremos que estés feliz con tu compra. No dudes en contactarnos si necesitás ayuda.
      `.trim(),
      lastUpdated: new Date('2025-01-29'),
    },
    {
      id: 'policy-payment',
      type: 'refund',
      title: 'Formas de Pago',
      content: `
**Opciones de Pago:**

**1. Tarjeta de Crédito:**
- 6 cuotas sin interés
- Aceptamos las principales tarjetas de crédito

**2. Transferencia o Depósito Bancario:**
- 10% de descuento
- Pago directo en cuenta bancaria
- Confirmación rápida de pedido

**Proceso de Compra:**
1. Elegí tus productos y agregá al carrito
2. Seleccioná tu método de pago preferido
3. Completá los datos de envío
4. Confirmá tu compra

**Seguridad:**
Todas las transacciones son seguras y protegidas.

**Consultas:**
Si tenés alguna duda sobre el pago, contactanos:
- WhatsApp: +54 9 11 3902-2938
- Email: hola@metta.com.ar
      `.trim(),
      lastUpdated: new Date('2025-01-29'),
    },
  ];

  private readonly businessInfo: BusinessInfo = {
    name: 'Metta',
    description:
      'Marca de ropa de mujer especializada en jeans. Creamos prendas que se sientan bien, que duren y que se adapten a tu cuerpo real. Talles del 34 al 50, con calidad real y accesible.',
    contact: {
      email: 'hola@metta.com.ar',
      phone: '+54 9 11 3902-2938',
      whatsapp: '+54 9 11 3902-2938',
    },
    address: {
      street: 'Edificio KM41 – Oficina 308, Colectora Sur Acceso Oeste Km 41',
      city: 'Francisco Álvarez',
      state: 'Buenos Aires',
      country: 'Argentina',
      postalCode: 'B1746',
    },
    businessHours: {
      monday: 'Consultar disponibilidad',
      tuesday: 'Consultar disponibilidad',
      wednesday: 'Consultar disponibilidad',
      thursday: 'Consultar disponibilidad',
      friday: 'Consultar disponibilidad',
      saturday: 'Consultar disponibilidad',
      sunday: 'Consultar disponibilidad',
    },
    socialMedia: {
      instagram: '@metta.jeans',
      facebook: 'Metta',
    },
  };

  constructor() {
    this.logger.log(
      `Knowledge base initialized with ${this.faqs.length} FAQs and ${this.policies.length} policies`,
    );
  }

  /**
   * Search the knowledge base for FAQs and policies
   * Performs case-insensitive keyword matching
   */
  search(
    query: string,
    category?: KnowledgeCategory,
  ): KnowledgeSearchResult {
    try {
      this.logger.debug(`Searching knowledge base: "${query}"`, { category });

      const normalizedQuery = query.toLowerCase().trim();
      const results: Array<FAQ | Policy> = [];

      // Search FAQs
      let relevantFAQs = this.faqs;
      if (category && category !== 'general') {
        relevantFAQs = this.faqs.filter((faq) => faq.category === category);
      }

      for (const faq of relevantFAQs) {
        const questionMatch = faq.question.toLowerCase().includes(normalizedQuery);
        const answerMatch = faq.answer.toLowerCase().includes(normalizedQuery);
        const keywordMatch = faq.keywords.some((keyword) =>
          keyword.toLowerCase().includes(normalizedQuery) ||
          normalizedQuery.includes(keyword.toLowerCase())
        );

        if (questionMatch || answerMatch || keywordMatch) {
          results.push(faq);
        }
      }

      // Search Policies
      let relevantPolicies = this.policies;
      if (category && category !== 'general') {
        relevantPolicies = this.policies.filter(
          (policy) => policy.type === category
        );
      }

      for (const policy of relevantPolicies) {
        const titleMatch = policy.title.toLowerCase().includes(normalizedQuery);
        const contentMatch = policy.content.toLowerCase().includes(normalizedQuery);

        if (titleMatch || contentMatch) {
          results.push(policy);
        }
      }

      this.logger.debug(`Found ${results.length} results for query "${query}"`);

      return {
        success: true,
        data: {
          results,
          count: results.length,
        },
      };
    } catch (error) {
      this.logger.error('Error searching knowledge base', {
        query,
        category,
        error: error.message,
      });
      return {
        success: false,
        error: `Failed to search knowledge base: ${error.message}`,
      };
    }
  }

  /**
   * Get a specific policy by type
   */
  getPolicy(policyType: PolicyType): PolicyResult {
    try {
      this.logger.debug(`Fetching policy: ${policyType}`);

      const policy = this.policies.find((p) => p.type === policyType);

      if (!policy) {
        return {
          success: false,
          error: `Policy not found: ${policyType}`,
        };
      }

      return {
        success: true,
        data: policy,
      };
    } catch (error) {
      this.logger.error('Error fetching policy', {
        policyType,
        error: error.message,
      });
      return {
        success: false,
        error: `Failed to fetch policy: ${error.message}`,
      };
    }
  }

  /**
   * Get business information (contact, hours, address, social media)
   */
  getBusinessInfo(): BusinessInfoResult {
    try {
      this.logger.debug('Fetching business information');

      return {
        success: true,
        data: this.businessInfo,
      };
    } catch (error) {
      this.logger.error('Error fetching business info', {
        error: error.message,
      });
      return {
        success: false,
        error: `Failed to fetch business information: ${error.message}`,
      };
    }
  }

  /**
   * Get all FAQs, optionally filtered by category
   */
  getAllFAQs(category?: KnowledgeCategory): FAQ[] {
    if (category && category !== 'general') {
      return this.faqs.filter((faq) => faq.category === category);
    }
    return this.faqs;
  }

  /**
   * Get all policies
   */
  getAllPolicies(): Policy[] {
    return this.policies;
  }
}
