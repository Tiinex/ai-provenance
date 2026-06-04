import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { validateTraceableRootSchemaSync } from "../src/traceableRootSchemaValidation.js";
import { validateTraceableTopicSchemaSync } from "../src/traceableTopicSchemaValidation.js";

function applyReplacements(markdown, replacements) {
  return replacements.reduce(
    (current, replacement) => current.replace(replacement.from, replacement.to),
    markdown
  );
}

function buildFixtureReadTextFileSync(fixture) {
  const baseMarkdownByPath = new Map();
  for (const filePath of fixture.baseFiles) {
    baseMarkdownByPath.set(path.resolve(filePath), readFileSync(filePath, "utf8"));
  }
  const overriddenMarkdownByPath = new Map();
  for (const override of fixture.overrides) {
    const absolutePath = path.resolve(override.filePath);
    const baseMarkdown = baseMarkdownByPath.get(absolutePath) ?? readFileSync(absolutePath, "utf8");
    overriddenMarkdownByPath.set(absolutePath, applyReplacements(baseMarkdown, override.replacements));
  }

  return (filePath) => {
    const absolutePath = path.resolve(filePath);
    if (overriddenMarkdownByPath.has(absolutePath)) {
      return overriddenMarkdownByPath.get(absolutePath);
    }
    if (baseMarkdownByPath.has(absolutePath)) {
      return baseMarkdownByPath.get(absolutePath);
    }
    return readFileSync(filePath, "utf8");
  };
}

export function runSchemaCompatibilityFixtures(packageRoot) {
  const rootSchemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const topicSchemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");

  const fixtures = [{
    name: "root undeclared envelope field warns",
    validator: validateTraceableRootSchemaSync,
    filePath: rootSchemaPath,
    baseFiles: [rootSchemaPath],
    overrides: [{
      filePath: rootSchemaPath,
      replacements: [{
        from: "- Summary: Root schema for Tiinex lineage artifacts.",
        to: "- Summmary: Root schema for Tiinex lineage artifacts."
      }]
    }],
    assert(result) {
      assert.ok(
        result.findings.some((finding) => finding.code === "root-schema-lineage-unexpected-envelope-field" && finding.message.includes("Summmary") && finding.severity === "warning"),
        "Compatibility fixture failed: root undeclared envelope fields should warn."
      );
    }
  }, {
    name: "topic unexpected vocabulary downgrades without lineage",
    validator: validateTraceableTopicSchemaSync,
    filePath: topicSchemaPath,
    baseFiles: [topicSchemaPath],
    overrides: [{
      filePath: topicSchemaPath,
      replacements: [{
        from: "### Topic Scope",
        to: "### Topi Scope"
      }, {
        from: "Applies To",
        to: "Applies T"
      }, {
        from: "- Trace: [tiinex.root.v1.schema.md](tiinex.root.v1.schema.md)",
        to: "- Trace: self"
      }]
    }],
    assert(result) {
      assert.ok(
        result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-group" && finding.severity === "warning"),
        "Compatibility fixture failed: unexpected topic groups should downgrade to warning without lineage."
      );
      assert.ok(
        result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-category-label" && finding.severity === "warning"),
        "Compatibility fixture failed: unexpected topic category labels should downgrade to warning without lineage."
      );
    }
  }, {
    name: "topic inherits root-declared envelope field lists",
    validator: validateTraceableTopicSchemaSync,
    filePath: topicSchemaPath,
    baseFiles: [topicSchemaPath, rootSchemaPath],
    overrides: [{
      filePath: topicSchemaPath,
      replacements: [{
        from: "- Summary: Schema for bounded topic-oriented lineage artifacts.",
        to: "- Summmary: Schema for bounded topic-oriented lineage artifacts."
      }]
    }, {
      filePath: rootSchemaPath,
      replacements: [{
        from: /Optional Fields\r?\n\r?\n- Summary/u,
        to: "Optional Fields\n\n- Summmary"
      }]
    }],
    assert(result) {
      assert.ok(
        !result.findings.some((finding) => finding.code === "topic-schema-lineage-unexpected-envelope-field" && finding.message.includes("Summmary")),
        "Compatibility fixture failed: topic should inherit allowed envelope field labels from root."
      );
    }
  }, {
    name: "topic preserve-only envelope unknown without lineage",
    validator: validateTraceableTopicSchemaSync,
    filePath: topicSchemaPath,
    baseFiles: [topicSchemaPath],
    overrides: [{
      filePath: topicSchemaPath,
      replacements: [{
        from: "- Summary: Schema for bounded topic-oriented lineage artifacts.",
        to: "- Summmary: Schema for bounded topic-oriented lineage artifacts."
      }, {
        from: "- Trace: [tiinex.root.v1.schema.md](tiinex.root.v1.schema.md)",
        to: "- Trace: self"
      }]
    }],
    assert(result) {
      assert.ok(
        result.findings.some((finding) => finding.code === "topic-schema-parent-trace-unresolvable"),
        "Compatibility fixture failed: preserve-only envelope case should still surface missing lineage."
      );
      assert.ok(
        !result.findings.some((finding) => finding.code === "topic-schema-lineage-unexpected-envelope-field"),
        "Compatibility fixture failed: unknown envelope fields should stay preserve-only when lineage is unavailable."
      );
    }
  }, {
    name: "topic invalid missing maintained group",
    validator: validateTraceableTopicSchemaSync,
    filePath: topicSchemaPath,
    baseFiles: [topicSchemaPath],
    overrides: [{
      filePath: topicSchemaPath,
      replacements: [{
        from: /### File Naming[\s\S]*?### Interpretation Boundaries/u,
        to: "### Interpretation Boundaries"
      }]
    }],
    assert(result) {
      assert.ok(
        result.findings.some((finding) => finding.code === "topic-schema-contract-groups-missing" && finding.message.includes("File Naming") && finding.severity === "error"),
        "Compatibility fixture failed: missing maintained groups should remain invalid."
      );
    }
  }, {
    name: "topic exact category labels remain case-sensitive",
    validator: validateTraceableTopicSchemaSync,
    filePath: topicSchemaPath,
    baseFiles: [topicSchemaPath],
    overrides: [{
      filePath: topicSchemaPath,
      replacements: [{
        from: "Applies To",
        to: "applies to"
      }]
    }],
    assert(result) {
      assert.ok(
        result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-category-label" && finding.message.includes("applies to") && finding.severity === "error"),
        "Compatibility fixture failed: contract category labels should remain exact and case-sensitive when lineage is available."
      );
    }
  }, {
    name: "topic duplicate category labels remain invalid",
    validator: validateTraceableTopicSchemaSync,
    filePath: topicSchemaPath,
    baseFiles: [topicSchemaPath],
    overrides: [{
      filePath: topicSchemaPath,
      replacements: [{
        from: "### Topic Body",
        to: "Rules\n\n- Duplicate rule marker.\n\n### Topic Body"
      }]
    }],
    assert(result) {
      assert.ok(
        result.findings.some((finding) => finding.code === "topic-schema-contract-duplicate-category-labels" && finding.message.includes("Topic Scope -> Rules") && finding.severity === "error"),
        "Compatibility fixture failed: duplicate category labels should remain invalid within the same contract group."
      );
    }
  }];

  for (const fixture of fixtures) {
    const readTextFileSync = buildFixtureReadTextFileSync(fixture);
    const result = fixture.validator({
      filePath: fixture.filePath,
      readTextFileSync
    });
    fixture.assert(result);
  }
}