/**
 * Rule pack for Ant Design projects. Activates when `antd` is a dependency.
 */

import type { RulePack } from "./index.js";
import { noHardcodedHexColor } from "./evaluators/antd-evaluators.js";

export const antdRules: RulePack = {
  id: "antd",
  label: "Ant Design",
  when: (ctx) => ctx.deps["antd"] !== undefined,
  rules: [
    {
      kind: "should",
      id: "antd/form-controlled-by-form",
      text: "Let `Form` own field state via `name` + `rules`; do not mirror field values into `useState` alongside `Form` instances.",
    },
    {
      kind: "should",
      id: "antd/theme-tokens",
      text: "Customize styling through `ConfigProvider` theme tokens instead of overriding `.ant-*` class names with CSS.",
    },
    {
      kind: "must",
      id: "antd/table-row-keys",
      text: "Always provide a stable `rowKey` for `Table` (a unique record field, not the array index).",
    },
    {
      kind: "avoid",
      id: "antd/no-static-context-apis",
      text: "Prefer the hook-based `App`/`useApp()` or `message.useMessage()` APIs over static `message`/`notification`/`Modal` calls so theme and context apply.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx"],
  evaluators: [noHardcodedHexColor],
};
