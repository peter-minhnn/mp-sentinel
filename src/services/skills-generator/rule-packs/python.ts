/**
 * Rule pack for Python projects
 */

import type { RulePack } from "./index.js";

export const pythonRules: RulePack = {
  id: "python",
  label: "Python",
  when: (ctx) => {
    const hasPy =
      ctx.langProfile.distribution["python"] !== undefined &&
      ctx.langProfile.distribution["python"]! > 0;
    return hasPy;
  },
  rules: [
    {
      kind: "must",
      text: "Use type hints for all function signatures (parameters and return types). Python type hints improve IDE support and enable `mypy` / `pyright` checking.",
    },
    {
      kind: "should",
      text: "Follow PEP 8: use 4-space indentation, snake_case for functions/variables, and UPPER_CASE for constants.",
    },
    {
      kind: "avoid",
      text: "Do NOT have top-level side effects in modules (e.g., `print()`, file I/O, network calls at module level). Use `if __name__ == '__main__':` guards.",
    },
    {
      kind: "should",
      text: "Use `pathlib.Path` for file system operations instead of `os.path` or raw string manipulation.",
    },
    {
      kind: "should",
      text: "Use `dataclasses` or `pydantic.BaseModel` for data containers instead of plain dictionaries or manual classes.",
    },
    {
      kind: "must",
      text: "Use `async`/`await` for I/O-bound operations. Avoid `time.sleep()` in async code -- use `asyncio.sleep()`.",
    },
  ],
  fileGlobs: ["**/*.py", "**/*.pyi"],
};
