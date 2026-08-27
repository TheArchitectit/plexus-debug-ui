// A Plexus request carries several model fields that diverge under routing:
//   incoming_model_alias  — what the client asked for (e.g. "claude-sonnet-5")
//   canonical_model_name  — the normalized target it maps to ("claude-sonnet-4-6")
//   selected_model_name   — the model plexus actually picked to serve
//   final_attempt_model   — ...and the one that succeeded, after retries
// Debugging "why is my opus request slow/broken" means seeing what *answered*,
// not just what was requested. served = the model that actually replied.
export function modelDisplay(row = {}) {
  const requested = row.incoming_model_alias || row.canonical_model_name || '';
  const served =
    row.final_attempt_model ||
    row.selected_model_name ||
    row.canonical_model_name ||
    row.incoming_model_alias ||
    '';
  const intended = row.canonical_model_name || requested;
  const different = Boolean(served && intended) && served !== intended;
  return { requested, served, different };
}
