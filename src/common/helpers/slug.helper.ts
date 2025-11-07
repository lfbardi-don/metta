/**
 * Generate URL-friendly slug from text
 *
 * Converts text to lowercase, removes accents and special characters,
 * and replaces spaces with hyphens for SEO-friendly URLs.
 *
 * @param text - The text to convert to slug
 * @returns URL-friendly slug
 *
 * @example
 * generateSlug('CHLOE RAW BLUE') // 'chloe-raw-blue'
 * generateSlug('Bermúdão Cargo') // 'bermudao-cargo'
 * generateSlug('Produto 2.0 (Novo!)') // 'produto-2-0-novo'
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase() // Convert to lowercase
    .trim() // Remove leading/trailing whitespace
    .normalize('NFD') // Normalize unicode (separates accents)
    .replace(/[\u0300-\u036f]/g, '') // Remove accent marks
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}
