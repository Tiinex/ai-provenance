const path = require('path');
const fs = require('fs');
const { validateTraceableContinuityArtifactChainSync } = require('../src/traceableContinuityValidation.js');

const filePath = path.resolve('c:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.feedback.v1.schema.md');
try {
  const result = validateTraceableContinuityArtifactChainSync({
    filePath,
    workspaceRoots: [],
    readTextFileSync: (p) => fs.readFileSync(p, 'utf8')
  });
  console.log(JSON.stringify(result.findings, null, 2));
} catch (err) {
  console.error('Validation failed:', err && err.stack ? err.stack : String(err));
  process.exit(1);
}
