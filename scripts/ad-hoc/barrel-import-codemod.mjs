#!/usr/bin/env node
// Ad-hoc codemod: replace every `import { X, Y } from "@/shared/components"`
// with direct imports from the source module, e.g.
//   import { Card } from "@/shared/components"
// → import Card from "@/shared/components/Card"
//   import { Modal, ConfirmModal } from "@/shared/components"
// → import Modal, { ConfirmModal } from "@/shared/components/Modal"
//
// The mapping mirrors src/shared/components/index.tsx exactly.
// Run: node scripts/ad-hoc/barrel-import-codemod.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const TEST = join(process.cwd(), "tests");

// name -> { module: relative dir, kind: "default" | "named" }
const EXPORT_MAP = {
  Button: { module: "./Button", kind: "default" },
  Input: { module: "./Input", kind: "default" },
  Select: { module: "./Select", kind: "default" },
  Checkbox: { module: "./Checkbox", kind: "default" },
  Textarea: { module: "./Textarea", kind: "default" },
  Card: { module: "./Card", kind: "default" },
  Collapsible: { module: "./Collapsible", kind: "default" },
  Modal: { module: "./Modal", kind: "default" },
  ConfirmModal: { module: "./Modal", kind: "named" },
  TALL_MODAL_PROPS: { module: "./Modal", kind: "named" },
  Loading: { module: "./Loading", kind: "default" },
  Spinner: { module: "./Loading", kind: "named" },
  PageLoading: { module: "./Loading", kind: "named" },
  Skeleton: { module: "./Loading", kind: "named" },
  CardSkeleton: { module: "./Loading", kind: "named" },
  Avatar: { module: "./Avatar", kind: "default" },
  Badge: { module: "./Badge", kind: "default" },
  Toggle: { module: "./Toggle", kind: "default" },
  ThemeToggle: { module: "./ThemeToggle", kind: "default" },
  ThemeProvider: { module: "./ThemeProvider", kind: "named" },
  Sidebar: { module: "./Sidebar", kind: "default" },
  Header: { module: "./Header", kind: "default" },
  Footer: { module: "./Footer", kind: "default" },
  OAuthModal: { module: "./OAuthModal", kind: "default" },
  ModelSelectModal: { module: "./ModelSelectModal", kind: "default" },
  ModelSelectField: { module: "./ModelSelectField", kind: "default" },
  ReasoningRoutingRules: { module: "./ReasoningRoutingRules", kind: "default" },
  ManualConfigModal: { module: "./ManualConfigModal", kind: "default" },
  UsageStats: { module: "./UsageStats", kind: "default" },
  UsageAnalytics: { module: "./UsageAnalytics", kind: "default" },
  RequestLoggerV2: { module: "./RequestLoggerV2", kind: "default" },
  RequestTimeline: { module: "./RequestTimeline", kind: "default" },
  ProxyConfigModal: { module: "./ProxyConfigModal", kind: "default" },
  ProxyLogger: { module: "./ProxyLogger", kind: "default" },
  KiroAuthModal: { module: "./KiroAuthModal", kind: "default" },
  KiroOAuthWrapper: { module: "./KiroOAuthWrapper", kind: "default" },
  KiroSocialOAuthModal: { module: "./KiroSocialOAuthModal", kind: "default" },
  CursorAuthModal: { module: "./CursorAuthModal", kind: "default" },
  TraeAuthModal: { module: "./TraeAuthModal", kind: "default" },
  RaycastAuthModal: { module: "./RaycastAuthModal", kind: "default" },
  SegmentedControl: { module: "./SegmentedControl", kind: "default" },
  Breadcrumbs: { module: "./Breadcrumbs", kind: "default" },
  EmptyState: { module: "./EmptyState", kind: "default" },
  NotificationToast: { module: "./NotificationToast", kind: "default" },
  FilterBar: { module: "./FilterBar", kind: "default" },
  ColumnToggle: { module: "./ColumnToggle", kind: "default" },
  DataTable: { module: "./DataTable", kind: "default" },
  NoAuthProviderCard: { module: "./NoAuthProviderCard", kind: "default" },
  NoAuthAccountCard: { module: "./NoAuthAccountCard", kind: "default" },
  CollapsibleSection: { module: "./CollapsibleSection", kind: "default" },
  InfoTooltip: { module: "./InfoTooltip", kind: "default" },
  PresetSlider: { module: "./PresetSlider", kind: "default" },
  DistributeProxiesButton: { module: "./DistributeProxiesButton", kind: "default" },
  SkillsConceptCard: { module: "./SkillsConceptCard", kind: "named" },
  DashboardLayout: { module: "./layouts/DashboardLayout", kind: "default" },
  AuthLayout: { module: "./layouts/AuthLayout", kind: "default" },
};

function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

// Parse one import statement's specifier block (between import and from).
function parseSpecifiers(block) {
  const trimmed = block.trim();
  if (!trimmed.startsWith("{")) return null;
  const inner = trimmed.slice(1, trimmed.lastIndexOf("}"));
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function rewriteFile(file) {
  const src = readFileSync(file, "utf8");
  if (!src.includes('from "@/shared/components"')) return { file, changed: false, count: 0 };

  let out = "";
  let last = 0;
  let count = 0;
  // Locate each barrel `from`, then backtrack to the start of ITS statement
  // (after the previous `;` or newline) to find the owning `import` keyword.
  let searchFrom = 0;
  while (true) {
    const fromIdx = src.indexOf('from "@/shared/components"', searchFrom);
    if (fromIdx === -1) break;
    // Statement start: after the previous `;` terminator (multiline imports
    // still end with `;`, so `\n` must NOT be treated as a boundary).
    const before = src.slice(0, fromIdx);
    const lastTerm = before.lastIndexOf(";");
    const stmtStart = lastTerm + 1;
    const stmtHead = src.slice(stmtStart, fromIdx);
    const importKw = stmtHead.lastIndexOf("import");
    if (importKw === -1) {
      // Not an import statement (e.g. a re-export) — skip.
      searchFrom = fromIdx + 1;
      continue;
    }
    const stmtBegin = stmtStart + importKw;
    // Statement ends at the terminating `;` after fromIdx.
    const semi = src.indexOf(";", fromIdx);
    const stmtEnd = semi === -1 ? src.length : semi + 1;
    const stmt = src.slice(stmtBegin, stmtEnd);
    const innerMatch = stmt.match(/^import\s+([\s\S]*?)\s+from\s+["']@\/shared\/components["'];?/);
    if (!innerMatch) {
      searchFrom = fromIdx + 1;
      continue;
    }
    const names = parseSpecifiers(innerMatch[1]);
    if (!names || names.some((n) => !EXPORT_MAP[n])) {
      // Unknown shape — leave untouched and report.
      out += src.slice(last, stmtEnd);
      last = stmtEnd;
      searchFrom = fromIdx + 1;
      console.warn(`  SKIP (unhandled): ${file}: ${stmt.replace(/\s+/g, " ").slice(0, 100)}`);
      continue;
    }
    // Group by module, preserving first-appearance order.
    const byModule = new Map();
    for (const name of names) {
      const info = EXPORT_MAP[name];
      if (!byModule.has(info.module)) byModule.set(info.module, []);
      byModule.get(info.module).push({ name, kind: info.kind });
    }
    const replacementLines = [];
    for (const [module, entries] of byModule) {
      const defaults = entries.filter((e) => e.kind === "default").map((e) => e.name);
      const named = entries.filter((e) => e.kind === "named").map((e) => e.name);
      const path = `@/shared/components${module.slice(1)}`;
      if (defaults.length && named.length) {
        replacementLines.push(`import ${defaults[0]}, { ${named.join(", ")} } from "${path}";`);
      } else if (defaults.length) {
        replacementLines.push(`import ${defaults[0]} from "${path}";`);
      } else {
        replacementLines.push(`import { ${named.join(", ")} } from "${path}";`);
      }
    }
    out += src.slice(last, stmtBegin) + replacementLines.join("\n");
    last = stmtEnd;
    count++;
    searchFrom = fromIdx + 1;
  }
  out += src.slice(last);
  if (count > 0 && out !== src) {
    writeFileSync(file, out);
    return { file, changed: true, count };
  }
  return { file, changed: false, count };
}

const files = [...collectFiles(SRC), ...collectFiles(TEST)];
let changedCount = 0;
let importCount = 0;
for (const file of files) {
  const r = rewriteFile(file);
  if (r.changed) {
    changedCount++;
    importCount += r.count;
    console.log(`  REWRITE ${file} (${r.count} import${r.count > 1 ? "s" : ""})`);
  }
}
console.log(`\nDone: ${changedCount} files, ${importCount} imports rewritten.`);
