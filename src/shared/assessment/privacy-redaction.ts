const patterns: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]"],
  [/(?<!\d)(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)\d{3,4}[-.\s]?\d{4}(?!\d)/g, "[PHONE]"],
  [/(?<!\d)\d{6}[-\s]?[1-4]\d{6}(?!\d)/g, "[IDENTIFIER]"],
  [/\b(?:account|acct|member|patient)\s*(?:id|number|no\.?)[\s:#-]*[A-Z0-9-]{4,}\b/gi, "[IDENTIFIER]"],
  [/\b\d{1,5}\s+[A-Za-z0-9.' -]+\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\b/gi, "[ADDRESS]"],
];
export function redactDirectIdentifiers(text: string, knownIdentityValues: string[] = []) {
  let redacted = text;
  for (const value of knownIdentityValues.filter((value) => value.trim().length > 1)) redacted = redacted.replaceAll(value, "[IDENTIFIER]");
  for (const [pattern, replacement] of patterns) redacted = redacted.replace(pattern, replacement);
  return redacted;
}
