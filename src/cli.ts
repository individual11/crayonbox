#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { checkStyle, formatSummary } from "./check.js";
import type { Platform } from "./catalog.js";
import { formatStyle } from "./fmt.js";
import { formatIssues } from "./issues.js";

const USAGE = `crayonbox — style guides in plain text

  crayonbox check <file.crayon|->      report problems by line, or print the summary
  crayonbox fmt   <file.crayon|-> [-w] tidy the text (-w rewrites the file)
  crayonbox render <file.crayon|-> [-o out.svg|out.png] [--platform web|ios|android] [--no-fetch]
                                  draw the style guide (SVG, or PNG with a .png name)

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
  if (!["check", "fmt", "render"].includes(cmd) || !file) {
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

  if (cmd === "render") return render(source, file, rest);

  const result = checkStyle(source);
  if (result.issues.length) console.error(formatIssues(result.issues));
  if (result.summary) console.log(formatSummary(result.summary));
  else process.exitCode = 1;
}

async function render(source: string, file: string, rest: string[]) {
  // Loaded here so check and fmt don't pay for the renderer and its fonts.
  const { renderChecked } = await import("./render.js");
  const result = checkStyle(source);
  const at = (flag: string) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined);
  const platform = at("--platform") as Platform | undefined;
  if (platform && !["web", "ios", "android"].includes(platform)) {
    console.error(`--platform is web, ios or android`);
    process.exitCode = 1;
    return;
  }
  if (result.issues.length) console.error(formatIssues(result.issues));
  if (!result.summary) {
    process.exitCode = 1;
    return;
  }
  const svg = await renderChecked(result, { platform, fetch: !rest.includes("--no-fetch"), source: file === "-" ? undefined : file.split("/").pop() });
  const out = at("-o");
  if (out?.endsWith(".png")) {
    const { Resvg } = await import("@resvg/resvg-js");
    await writeFile(out, new Resvg(svg, { fitTo: { mode: "zoom", value: 2 } }).render().asPng());
  } else if (out) await writeFile(out, svg);
  else process.stdout.write(svg);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
