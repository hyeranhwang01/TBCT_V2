// Generic guard against literal bracket placeholders ("[goal]", "[initial
// conclusion]", "[emotion named at Q3a]") reaching either side of the
// dialogue agent: sending one to Claude as if it were real content teaches
// it to treat the placeholder as the answer, and letting one back out to
// the participant is exactly the bug this whole layer exists to prevent
// (feedback v2 #5). This is intentionally broader than
// BRACKET_PLACEHOLDER_SOURCES in runtime-static-message.ts, which only
// knows about specific already-catalogued placeholders and substitutes a
// real value -- this one has no substitution to offer, it just refuses to
// pass the text through.
const UNRESOLVED_TEMPLATE_PATTERN = /\[[a-z][^[\]]{0,80}\]/i;

export function hasUnresolvedTemplateVariable(text: string): boolean {
  return UNRESOLVED_TEMPLATE_PATTERN.test(text);
}
