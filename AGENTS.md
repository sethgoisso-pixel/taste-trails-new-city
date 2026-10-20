<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All Qloo calls go through `qlooGet` in `src/lib/qloo.server.ts` (server-only): it owns the 24h DB cache, the retry cap and the API key, so no other code should call Qloo directly.
- Agent orchestration runs in the browser as a sequence of small server functions (`src/lib/taste.functions.ts`) so the trace can update live per step.
- Pure rules (limits, cache freshness, "why" copy) live in `src/lib/taste-rules.ts` and are unit-tested.
- Dark mode follows `prefers-color-scheme` via CSS media query, not a `.dark` class.
