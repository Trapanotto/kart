// Registry that maps SimEntity.kind prefixes to view factories. Owner: lead.
// Usage (in the module that owns the entity): registerEntityView('item.', (e, ctx) => new MyView(e, ctx));
import type { RenderContext, SimEntity, View } from './types';

export type EntityViewFactory = (entity: SimEntity, ctx: RenderContext) => View | null;

const factories: { prefix: string; make: EntityViewFactory }[] = [];
let fallback: EntityViewFactory | null = null;

/** Longer prefixes win. Registering the same prefix again replaces it. */
export function registerEntityView(prefix: string, make: EntityViewFactory): void {
  const i = factories.findIndex((f) => f.prefix === prefix);
  if (i >= 0) factories.splice(i, 1);
  factories.push({ prefix, make });
  factories.sort((a, b) => b.prefix.length - a.prefix.length);
}

export function setFallbackEntityView(make: EntityViewFactory): void {
  fallback = make;
}

export function createEntityView(entity: SimEntity, ctx: RenderContext): View | null {
  for (const f of factories) if (entity.kind.startsWith(f.prefix)) return f.make(entity, ctx);
  return fallback ? fallback(entity, ctx) : null;
}
