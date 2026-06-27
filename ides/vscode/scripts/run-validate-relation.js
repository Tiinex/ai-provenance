const fs = require('fs');
const path = require('path');
const { validateTraceableTopicSchemaSync } = require('../src/traceableTopicSchemaValidation.js');

const filePath = path.resolve('c:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.relation.v1.schema.md');
try {
  const result = validateTraceableTopicSchemaSync({
    filePath,
    readTextFileSync: (p) => fs.readFileSync(p, 'utf8')
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Validation failed:', err && err.stack ? err.stack : String(err));
  process.exit(1);
}
