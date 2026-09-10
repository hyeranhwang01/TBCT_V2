export function resolveRuntimeFallback(input: { nodeFallback?: string; locale: string }) {
  return input.nodeFallback
    ?? (input.locale.startsWith("ko")
      ? "We had trouble processing the response. Please try again in a moment."
      : "We had trouble processing the response. Please try again in a moment.");
}
