#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { checkStyle, formatSummary } from "./check.js";
import { formatStyle } from "./fmt.js";
import { formatIssues } from "./issues.js";

const USAGE = `crayonbox — style guides in plain text

  crayonbox check <file.crayon|->      report problems by line, or print the summary
  crayonbox fmt   <file.crayon|-> [-w] tidy the text (-w rewrites the file)

Use - to read from stdin.
`;

async function readInput(file: string) {
  if (file !== "-") return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const file = rest.find((a) => a === "-" || !a.startsWith("-"));
  if (!["check", "fmt"].includes(cmd) || !file) {
    process.stdout.write(USAGE);
    process.exitCode = cmd && cmd !== "help" ? 1 : 0;
    return;
  }
  const source = await readInput(file);

  if (cmd === "fmt") {
    const out = formatStyle(source);
    if (rest.includes("-w") && file !== "-") await writeFile(file, out);
    else process.stdout.write(out);
    return;
  }

  const result = checkStyle(source);
  if (result.issues.length) console.error(formatIssues(result.issues));
  if (result.summary) console.log(formatSummary(result.summary));
  else process.exitCode = 1;
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
