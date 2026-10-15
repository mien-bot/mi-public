import { z } from "zod";

/**
 * Builds a genuine patch shape: every key optional, and — unlike `.partial()` —
 * a key the caller omitted stays omitted.
 *
 * Do not replace this with `.partial()`. Zod 4 leaves a field's `.default()`
 * live underneath the optional wrapper, so parsing `{ address }` against a
 * partial of a defaulted shape returns *every* key, with the unsent ones filled
 * in as `""` / `[]` / `null`. Spread that result over a stored record and each
 * field the caller never mentioned is silently cleared. That is not theoretical:
 * it blanked client_name, scope and project_type on a real project when a
 * three-key project-details proposal was confirmed. Stripping the ZodDefault
 * wrapper before making the field optional is what keeps "only the submitted
 * keys" true — and it is also what lets callers distinguish "field omitted"
 * from "field explicitly set to its empty value" by testing for `undefined`.
 *
 * Lives in its own module rather than lib/schema.ts because lib/personal/schema.ts
 * needs it too and must not import the project schema (Turbopack module-init
 * cycle during production page-data collection — see the note there).
 */
export function patchShape<Shape extends z.ZodRawShape>(
  shape: Shape,
): { [K in keyof Shape]: z.ZodOptional<Shape[K]> } {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => {
      // A ZodRawShape is typed as the core `$ZodType`, which carries no builder
      // methods; the runtime values are always full schemas.
      const unwrapped = (field instanceof z.ZodDefault ? field.def.innerType : field) as z.ZodType;
      return [key, unwrapped.optional()];
    }),
  ) as unknown as { [K in keyof Shape]: z.ZodOptional<Shape[K]> };
}
