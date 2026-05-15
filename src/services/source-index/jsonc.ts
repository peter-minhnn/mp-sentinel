/**
 * Minimal JSONC support for project config files.
 *
 * This intentionally avoids regex comment stripping because valid tsconfig
 * strings commonly contain slash-star alias and glob patterns.
 */

function stripJsoncComments(content: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i]!;
    const next = content[i + 1];

    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = "";
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      output += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < content.length) {
        const lineCh = content[i]!;
        if (lineCh === "\n" || lineCh === "\r") {
          output += lineCh;
          i++;
          if (lineCh === "\r" && content[i] === "\n") {
            output += content[i]!;
            i++;
          }
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < content.length) {
        const blockCh = content[i]!;
        const blockNext = content[i + 1];
        if (blockCh === "\n" || blockCh === "\r") {
          output += blockCh;
          i++;
          if (blockCh === "\r" && content[i] === "\n") {
            output += content[i]!;
            i++;
          }
          continue;
        }
        if (blockCh === "*" && blockNext === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    output += ch;
    i++;
  }

  return output;
}

function stripJsoncTrailingCommas(content: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;

    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      output += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j]!)) {
        j++;
      }
      if (content[j] === "}" || content[j] === "]") {
        continue;
      }
    }

    output += ch;
  }

  return output;
}

export function parseJsoncObject(content: string): Record<string, unknown> {
  const withoutComments = stripJsoncComments(content);
  const withoutTrailingCommas = stripJsoncTrailingCommas(withoutComments);
  const parsed = JSON.parse(withoutTrailingCommas) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("JSONC root must be an object");
  }
  return parsed as Record<string, unknown>;
}
