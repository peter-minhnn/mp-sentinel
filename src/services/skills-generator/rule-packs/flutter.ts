import type { RulePack } from "./index.js";

export const flutterRules: RulePack = {
  id: "flutter",
  label: "Flutter",
  when: (ctx) => ctx.frameworks.includes("flutter"),
  rules: [
    {
      kind: "must",
      text: "Use `BuildContext` correctly — never store it beyond the widget's build scope.",
    },
    {
      kind: "must",
      text: "Handle async errors in `initState` and lifecycle methods — use `addPostFrameCallback` or `WidgetsBindingObserver`.",
    },
    {
      kind: "should",
      text: "Prefer `StatelessWidget` by default; only use `StatefulWidget` when local state is genuinely needed.",
    },
    {
      kind: "should",
      text: "Use `const` widgets wherever possible for better rebuild performance.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `BuildContext` across async gaps — use `mounted` checks or `context.mounted` (Flutter 3.7+).",
    },
    {
      kind: "avoid",
      text: "Do NOT put business logic directly in widgets — extract to `ChangeNotifier`, `Riverpod`, or `Bloc`.",
    },
  ],
  fileGlobs: ["**/*.dart", "lib/**"],
};
