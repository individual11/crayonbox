/**
 * Problems found in a style file. Messages feed an LLM's repair loop, so each one names
 * the line and says what to do. Warnings pass the file; errors stop it.
 */
export type Issue = { line: number; message: string; severity: "error" | "warning" };

export const errorsIn = (issues: Issue[]) => issues.filter((i) => i.severity === "error");

/** One problem per line of text, errors first, in line order within each group. */
export function formatIssues(issues: Issue[]): string {
  const order = (i: Issue) => (i.severity === "error" ? 0 : 1);
  return [...issues]
    .sort((a, b) => order(a) - order(b) || a.line - b.line)
    .map((i) => `line ${i.line}: ${i.severity === "warning" ? "warning: " : ""}${i.message}`)
    .join("\n");
}

export class Issues {
  readonly list: Issue[] = [];
  private seen = new Set<string>();
  error(line: number, message: string) {
    this.add({ line, message, severity: "error" });
  }
  warn(line: number, message: string) {
    this.add({ line, message, severity: "warning" });
  }
  private add(issue: Issue) {
    const key = `${issue.line}|${issue.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(issue);
  }
}
