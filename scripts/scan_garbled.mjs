// One-off investigation: find neuralwatt deepseek-v4-pro/flash requests whose
// reassembled output matches the garbled signature seen on 2026-08-27.
// Run inside the AI01 container: node scripts/scan_garbled.mjs [daysBack]
// Reads PLEXUS_API_URL + admin key from the mounted plexus.yaml via config.
import { plexusApi } from "../services/plexusApi.js";
import { analyzeResponse } from "../services/providerReport.js";

const DAYS = Number(process.argv[2] || 2);
const PROVIDER = "neuralwatt";
const from = new Date(Date.now() - DAYS * 86400e3).toISOString();

// Garbling heuristics, calibrated on AI01 against the two known-bad incident
// requests vs 15 known-normal deepseek-v4 outputs (see calibrate_garble.mjs):
//   normal:  funcWord >= 0.11, midUpper ~0, embDigit <= 0.006
//   known-bad: funcWord 0.043/0.006, midUpper 0.045-0.056, broken tags present
const MIN_LEN = 200;
const THRESHOLD = Number(process.env.THRESHOLD || 40);

function features(text) {
  const n = text.length;
  const f = (re) => (text.match(re) || []).length;
  const words = text.split(/\s+/).filter(Boolean);
  const alpha = words.filter((w) => /[A-Za-z]{2,}/.test(w));
  const a = Math.max(1, alpha.length);
  return {
    junkSym: f(/[<>{}|`~^]/g) / n,
    embDigit: f(/[a-zA-Z]\d|\d[a-zA-Z]/g) / n,
    midUpper: f(/[a-z][A-Z]{2,}|[A-Z]{3,}[a-z]/g) / a,
    badTag: f(/<\/?[a-z]{2,}[a-z0-9]*[^>\s]*>/gi) / a,
    funcWord: alpha.filter((w) => /^(the|and|of|to|a|in|is|that|it|for|was|with|as|are|be|by|on|not|you|we|this|have|has|from|or|an|but|can|all|their|there|which|when|what)$/i.test(w)).length / a,
  };
}

function garbleScore(text) {
  if (!text || text.length < MIN_LEN) return 0;
  const x = features(text);
  let s = 0;
  if (x.funcWord < 0.08) s += 30; else if (x.funcWord < 0.12) s += 15;
  if (x.midUpper > 0.03) s += 25;
  if (x.embDigit > 0.008) s += 20;
  if (x.badTag > 0.003) s += 15;
  if (x.junkSym > 0.05) s += 10;
  return s;
}

const all = [];
let offset = 0;
for (;;) {
  const res = await plexusApi.listUsage({ provider: PROVIDER, dateFrom: from, limit: 500, offset });
  const page = res.data || [];
  all.push(...page);
  offset += page.length;
  if (page.length < 500 || offset >= Number(res.total ?? 0)) break;
}
// "model" in the API filters the incoming alias; DS4 pro/flash are routing
// targets, so match on selected_model_name locally.
const re = /deepseek-v4-(pro|flash)/i;
const rows = all.filter((r) => re.test(String(r.selected_model_name || "")));
console.log(`scanning ${rows.length} of ${all.length} ${PROVIDER} rows since ${from} (served deepseek-v4 pro/flash)`);

// Pre-screen: garbling tends to inflate output tokens oddly, produce very short
// or very long outputs, or error-ish finishes. Analyze every row that carries
// plausible signals; skip tiny/no-output rows.
const candidates = rows
  .filter((r) => (Number(r.tokens_output) || 0) >= 20 || (r.finish_reason || "").toLowerCase() === "error")
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .slice(0, Number(process.env.MAX_ANALYZE || 600));
console.log(`analyzing ${candidates.length} payloads (out tokens >= 20 or error)`);

const suspects = [];
let analyzed = 0;
const CONC = 8;
for (let i = 0; i < candidates.length; i += CONC) {
  await Promise.all(candidates.slice(i, i + CONC).map(async (r) => {
    analyzed++;
    let debug = null;
    try { debug = await plexusApi.getDebugLog(r.request_id); } catch { /* not stored */ }
    const a = analyzeResponse(debug);
    if (!a.present) return;
    const score = Math.max(garbleScore(a.assistantText), garbleScore(a.reasoningText));
    if (score >= THRESHOLD) {
      suspects.push({
        request_id: r.request_id, time: r.date, alias: r.incoming_model_alias,
        served: r.selected_model_name, out: Number(r.tokens_output) || 0, score,
        scoreAsst: garbleScore(a.assistantText), scoreReason: garbleScore(a.reasoningText),
        responseId: a.responseId, len: a.assistantText.length,
        sample: a.assistantText.replace(/\s+/g, " ").slice(0, 140),
      });
    }
  }));
}
suspects.sort((x, y) => y.score - x.score);
console.log(`analyzed ${analyzed} payloads, ${suspects.length} garble matches (score>=35):`);
for (const s of suspects) console.log(JSON.stringify(s));
