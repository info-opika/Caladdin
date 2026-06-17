import { z } from 'zod';

/** Minimal Zod → JSON Schema for Anthropic tool definitions. */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodTypeToJson(value as z.ZodTypeAny);
      if (!(value as z.ZodTypeAny).isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return zodTypeToJson(schema);
}

function zodTypeToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) {
    return zodTypeToJson(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return zodTypeToJson(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: 'string' };
    if (schema._def.checks) {
      for (const check of schema._def.checks) {
        if (check.kind === 'email') out.format = 'email';
        if (check.kind === 'min') out.minLength = check.value;
        if (check.kind === 'max') out.maxLength = check.value;
      }
    }
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema._def.values };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodTypeToJson(schema._def.type as z.ZodTypeAny),
    };
  }
  if (schema instanceof z.ZodObject) {
    return zodToJsonSchema(schema);
  }
  return { type: 'string' };
}
