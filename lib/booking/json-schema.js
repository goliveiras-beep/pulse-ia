// lib/booking/json-schema.js
// Deriva o JSON Schema da tool/response_format a partir do Zod (nunca escrito a
// mao - spec 4.3: "ele sai de sincronia com a validacao e o bug e silencioso").
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolInput } from './schema.js';

let cache = null;

export function schemaExtracao() {
  if (cache) return cache;
  cache = zodToJsonSchema(ToolInput, {
    name: 'submit_extraction',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }).definitions.submit_extraction;
  return cache;
}
