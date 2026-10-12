// The main import: parser, checker and formatter. No dependencies.
export { checkStyle, formatSummary, type CheckResult, type Component, type Level, type Role, type Style, type Summary, type TypeStyle } from "./check.js";
export { contrast, parseColor, toHex, type RGBA } from "./color.js";
export { formatStyle } from "./fmt.js";
export { formatIssues, type Issue } from "./issues.js";
export { parseStyle, type Block, type Item, type StyleFile } from "./parse.js";
export { COMPONENTS, KNOWN_ROLES, RULES, SECTIONS } from "./catalog.js";
