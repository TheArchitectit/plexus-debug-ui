// Calibration for the garble detector: compute candidate features on the two
// KNOWN-bad requests vs a sample of presumably-normal deepseek-v4 outputs.
// Run inside the AI01 container: node scripts/calibrate_garble.mjs
import { plexusApi } from "../services/plexusApi.js";
import { analyzeResponse } from "../services/providerReport.js";

const KNOWN_BAD = [
  "e9e55488-4043-4e35-8550-a40bbda0bf9e",
  "6024fec2-b073-4927-bf4f-3a12740eb17f",
];

export function features(text) {
  if (!text) return null;
  const n = text.length;
  const words = text.split(/\s+/).filter(Boolean);
  const alpha = words.filter((w) => /[A-Za-z]{2,}/.test(w));
  const f = (re) => (text.match(re) || []).length;
  return {
    len: n,
    // junk symbols that are rare in normal prose/JSON-in-prose
    junkSym: f(/[<>{}|`~^]/g) / n,
    // digits glued to letters: but73another, RETRIBU0apparatus, 941A
    embDigit: f(/[a-zA-Z]\d|\d[a-zA-Z]/g) / n,
    // random mid-word capitals: hearingOLFO, allmove? no—needs lower then UPPER run
    midUpper: f(/[a-z][A-Z]{2,}|[A-Z]{3,}[a-z]/g) / Math.max(1, alpha.length),
    // broken or invented HTML tags: </hurned> <h1n
    badTag: f(/<\/?[a-z]{2,}[a-z0-9]*[^>\s]*>/gi) / Math.max(1, alpha.length),
    // english function-word density — normal prose ~0.15+, salad much lower
    funcWord: alpha.filter((w) => /^(the|and|of|to|a|in|is|that|it|for|was|with|as|are|be|by|on|not|you|we|this|have|has|from|or|an|but|can|all|their|there|which|when|what)$/i.test(w)).length / Math.max(1, alpha.length),
    // non-alphabetic words (contain digits/punct) as share of words
    dirtyWord: words.filter((w) => /[^A-Za-z'’-]/.test(w)).length / Math.max(1, words.length),
  };
}

async function featFor(id) {
  const dbg = await plexusApi.getDebugLog(id).catch(() => null);
  const a = analyzeResponse(dbg);
  return { id, feats: features(a.assistantText), hasText: a.assistantText.length > 0 };
}

console.log("=== KNOWN BAD ===");
for (const id of KNOWN_BAD) console.log(JSON.stringify(await featFor(id)));

console.log("=== SAMPLE NORMAL (recent, 300-8000 char outputs) ===");
const all = [];
let offset = 0;
for (;;) {
  const res = await plexusApi.listUsage({ provider: "neuralwatt", dateFrom: new Date(Date.now() - 48 * 3600e3).toISOString(), limit: 500, offset });
  const page = res.data || [];
  all.push(...page);
  offset += page.length;
  if (page.length < 500 || all.length >= 2500) break;
}
const rows = all.filter((r) => /deepseek-v4-(pro|flash)/i.test(String(r.selected_model_name || "")) && Number(r.tokens_output) >= 100 && Number(r.tokens_output) <= 3000);
console.log(`(pool: ${all.length} rows, ${rows.length} candidates)`);
let shown = 0;
for (const r of rows) {
  if (shown >= 15) break;
  const o = await featFor(r.request_id);
  if (!o.hasText) continue;
  console.log(JSON.stringify(o));
  shown++;
}
