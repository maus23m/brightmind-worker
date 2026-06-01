// BrightMind V2 — Review merge logic (CR-016)
// Standalone module (like compute.js) so the audit/child merge is independently
// unit-testable (see review.test.js) without pulling in
// @google-cloud/functions-framework or making a network call.
//
// WHY THIS EXISTS: stages 4 (Audit) and 5 (Child Agent) used to be two separate
// Claude calls over the same question list. CR-016 merges them into ONE call with
// a combined prompt to halve the model round-trips against the ~26s wall-clock
// budget. index.js owns the network call + prompt loading; this module owns the
// two pure transforms: shaping the questions payload and applying the combined
// {audit, child} verdicts back onto the question list. The applied semantics
// reproduce the old audit()/childAgent() behaviour exactly (DEF-035 diagram
// awareness, DEF-041 compute-verified answer lock, fail-open on missing results).

// buildReviewQuestions — the questions_json payload. Union of the old audit and
// child shapes: audit needs c/e/diagramPrompt/computeVerified, child needs hasDiagram.
function buildReviewQuestions(qs) {
  return qs.map((q, i) => ({
    i,
    q: q.q,
    o: q.o,
    c: q.c,
    e: q.e,
    hasDiagram: !!q.svg,
    // DEF-035: give the auditor the diagramPrompt so criterion 3 can catch
    // question-diagram data mismatches (previously only a hasDiagram boolean).
    diagramPrompt: q.diagramPrompt || null,
    // DEF-041: tell the auditor which questions the compute engine already verified,
    // so criterion 4 does not re-judge arithmetic it is unreliable at.
    computeVerified: !!(q._computeVerified || q._computeCorrected),
  }));
}

// applyReview — fold the combined verdicts back onto the question list. Mirrors the
// old two-stage flow: audit verdict (rewrite/drop) first, then the child flag is
// applied ONLY to questions that did not audit-fail (childAgent used to run on
// auditPassed). Questions with no matching result pass through unchanged (fail-open).
function applyReview(qs, results) {
  return qs.map((q, i) => {
    const r = (results || []).find((x) => x.i === i);
    if (!r) return q;

    const a = r.audit || {};
    const child = r.child || {};

    // ── Audit part (from the old audit()) ──
    let out;
    if (a.pass === false) {
      if (a.rewrite && a.rewrite.q && Array.isArray(a.rewrite.o) && a.rewrite.o.length === 4 && typeof a.rewrite.c === "number") {
        const rw = { ...a.rewrite, e: a.rewrite.e || q.e, ...(q.svg ? { svg: q.svg } : {}), _auditRewritten: true };
        // DEF-041 guard: never let an audit rewrite silently override a
        // compute-verified answer index. If the engine verified c, keep c.
        if ((q._computeVerified || q._computeCorrected) && rw.c !== q.c) {
          rw.c = q.c;
          rw._auditCFixedToCompute = true;
        }
        out = rw;
      } else {
        // Unfixable audit fail — drop. Child verdict is not applied (the old
        // childAgent never saw audit-failed questions).
        return { ...q, _auditFailed: true, _auditReason: a.reason || "failed" };
      }
    } else {
      out = q;
    }

    // ── Child part (from the old childAgent()), only on audit-passed questions ──
    if (child.pass === false) {
      return { ...out, _childFailed: true, _childReason: child.reason || "flagged" };
    }
    return out;
  });
}

module.exports = { buildReviewQuestions, applyReview };
