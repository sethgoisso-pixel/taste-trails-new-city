# Taste Bridge

Carry what you love to a new city.

## Problem
Moving cities (say, Cotonou to Berlin) means losing your cultural map: the restaurants, nightlife, music and stories that felt like home. Generic "top 10" lists ignore taste.

## Solution
Taste Bridge takes your home city, target city and up to 5 favorites (artists, movies, books or brands) and uses the [Qloo](https://qloo.com) cultural taste graph to find what **people who like those things tend to enjoy** in the target city. Results are grouped places (food, nightlife, culture), recommended music, movies and books, and a week-by-week plan for your first 30 days.

A **With Qloo / AI alone** toggle shows what a plain AI answer gives without Qloo data, so the difference is visible.

## How the agent works
1. **Resolve favorites**: `GET /search` per favorite (parallel) to get Qloo entity IDs.
2. **Read taste tags**: `GET /v2/insights` with `filter.type=urn:tag` and `signal.interests.entities`.
3. **Find places**: three parallel `/v2/insights` calls with `filter.type=urn:entity:place`, `filter.tags` (food / nightlife / culture) and `filter.location.query=<target city>`.
4. **Find media**: three parallel `/v2/insights` calls for artists, movies and books, weighted to the target city with `signal.location.query`.
5. **Write the plan**: the built-in Lovable AI writes a 4-week plan using **only** the returned data.

Each step and every Qloo call (endpoint, parameters without the key, result count, duration, cache hit) is shown live in the Agent trace panel.

### Quality and Safeguards
- **Territorial filtering**: Places are accepted only if their locality or address matches the target city (case/accent-insensitive). For Berlin, postal codes are strictly verified (10115 to 14199, rejecting Potsdam 14467+ and surrounding regions).
- **Zero hallucinations**: 30-day plan generation enforces that every named venue, artist or title cited belongs to verified Qloo results.
- **Auditable affinity**: Badges display "Strong match" or "Medium match" derived from Qloo affinity scores or shared taste tags. No fabricated percentages.
- **Dynamic resolution**: "X of Y resolved" precisely reports resolved items and names any missing favorite.

### Backend
- All Qloo calls run on the server (TanStack Start server functions on Lovable Cloud). The `QLOO_API_KEY` secret never reaches the browser.

- Every Qloo response is cached in the database for 24 hours.
- Retries are limited to 2, only for rate limits and server errors.
- Errors are shown as clear messages; the page never goes blank.
- Only city names and favorite titles are sent to Qloo. No personal data.

## Accessibility
- Light and dark themes following the system preference; WCAG AA contrast tokens.
- Status is shown with icons and text, never color alone.
- `aria-live` region announces agent trace progress; labelled controls and tabs.
- Visible keyboard focus, 44px touch targets, text at least 12px.
- Respects `prefers-reduced-motion`; full-screen mobile layout.

## Limits
- Qloo results describe group tendencies, not personal predictions.
- Qloo coverage varies by city and category; some groups may be empty.
- The hackathon API has a quota; when reached, the app shows a message and cached results still work.
- The "AI alone" answer may contain invented or outdated places — that is the point of the comparison.

## Development
```sh
npm i
npm run dev
```

Built with TanStack Start, React, Tailwind CSS and Lovable Cloud.

## License
MIT — see [LICENSE](./LICENSE).
