// bce/engine/template.ts
import Handlebars from 'handlebars';

export function interpolate(
  template: string,
  context: Record<string, unknown>,
  source?: string,
): string {
  try {
    const compiled = Handlebars.compile(template, { noEscape: true, strict: true });
    return compiled(context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const location = source ? ` in ${source}` : '';
    throw new Error(
      `Template interpolation failed${location}: ${msg}. ` +
      `Available context keys: ${JSON.stringify(Object.keys(context))}`
    );
  }
}
