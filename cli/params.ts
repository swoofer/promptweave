export function collect(val: string, prev: string[]): string[] {
  return prev.concat([val]);
}

export function parseSetParams(
  sets: string[],
): Record<string, Record<string, unknown>> {
  const params: Record<string, Record<string, unknown>> = {};
  for (const s of sets) {
    const eqIdx = s.indexOf("=");
    if (eqIdx === -1) continue;
    const path = s.substring(0, eqIdx);
    const val = s.substring(eqIdx + 1);
    const dotIdx = path.indexOf(".");
    if (dotIdx === -1) continue;
    const behavior = path.substring(0, dotIdx);
    const param = path.substring(dotIdx + 1);
    if (!params[behavior]) params[behavior] = {};
    try {
      params[behavior][param] = JSON.parse(val);
    } catch {
      params[behavior][param] = val;
    }
  }
  return params;
}
