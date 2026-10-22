# Taste Bridge

**Carry what you love to your new city.**
Built for the Qloo Agentic Hackathon. Live demo: https://taste-trails-new-city.lovable.app

## 1. Problem

Moving to a new city (say, Cotonou to Berlin) means losing your cultural map: the places, music and stories that felt like home. Generic "top 10" lists ignore taste, and an AI chatbot alone happily invents venues.

I built this because I am preparing an Ausbildung (vocational training) in Germany as a plan B alongside my software projects, and I wanted a way to find "my kind of places" before I arrive.

## 2. Qloo workflow and why it fits

Qloo's cultural taste graph answers a question a plain LLM cannot: **what do people who share these tastes actually go to?** Taste Bridge uses two Qloo endpoints (hackathon API, key kept server-side):

| Step | Qloo call | Why |
|---|---|---|
| Resolve favorites | `GET /search` (one per favorite) | Turn "Burna Boy" into a Qloo entity ID |
| Read taste tags | `GET /v2/insights` with `filter.type=urn:tag` | Understand what the favorites have in common (the explanation layer) |
| Places | `GET /v2/insights` with `filter.type=urn:entity:place`, `filter.tags`, `filter.location.query=<target city>` | Find places in the target city that share the audience |
| Music, movies, books | `GET /v2/insights` with `filter.type=urn:entity:artist`, `movie` or `book`, and `signal.location.query=<target city>` | Cross-domain recommendations |

Qloo results are used as **evidence** in the product flow: each card shows its own tag-based reason and a match badge. The 30-day plan is written by an AI model that may only name entities returned by Qloo.

## 3. Request-to-result example (redacted)

Input: home city `Cotonou`, target city `Berlin`, favorites `Burna Boy, Angélique Kidjo, Black Panther, Nike, Americanah` (all 5 resolved).

```
GET /search query=Burna Boy · take=1                         -> 1 entity
GET /v2/insights filter.type=urn:tag
    filter.tag.types=urn:tag:genre:media,urn:tag:genre:place
    signal.interests.entities=<5 entity ids> · take=25       -> 25 tags
GET /v2/insights filter.type=urn:entity:place
    filter.tags=urn:tag:genre:place:restaurant,...cafe
    filter.location.query=Berlin
    signal.interests.entities=<5 entity ids> · take=15       -> 15 places, 4 kept
```

Entity and tag choices: only genre, cuisine, ambience and audience tags are kept. Venue categories and formats ("Restaurant", "Audiobook", "Park") are removed from the taste profile because they say what something is, not what someone likes. The live **Agent trace** panel shows every call (endpoint, parameters without the key, result count, duration, cache hit).

## 4. Demo

Open the live demo and press **Try the demo**. The **With Qloo / AI alone** tab shows the same favorites answered without Qloo data.

## 5. Setup from a clean environment

Requirements: Node 22+ (or bun), a Supabase project (one table is used as a 24h cache), a Qloo **hackathon** API key, and a Lovable AI key (for the plan text).

```sh
git clone https://github.com/sethgoisso-pixel/taste-trails-new-city
cd taste-trails-new-city
npm install
```

1. Create the cache table by running `drizzle/migrations/0000_qloo_cache.sql` in your Supabase SQL editor.
2. Create a `.env.local` file with:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `QLOO_API_KEY` (hackathon key, server only, never commit it)
   - `LOVABLE_API_KEY` (AI gateway for the plan text)
3. `npm run dev`, then `npm test` for the unit tests.

On Lovable Cloud, the same values are stored as project secrets.

## 6. Known limitations (what the results do not establish)

- Qloo returns **group tendencies**, not what a person will like. The UI says "people who like X tend to enjoy Y", never "you will love".
- Coverage varies: some local artists (for example Beninese artists) are not in the data. The app then says it could not match the favorite instead of guessing a different one.
- With few or very different favorites, some categories (often books) have weak signal; the app shows an honest empty message instead of unrelated titles.
- The city filter checks the address; postal-code ranges are implemented for Berlin and Paris, other cities are matched by name only.
- The plan text is written by an AI model: every named venue or title is verified against Qloo results, but general tips are not from Qloo and are labeled as such.
- The hackathon API has a quota; responses are cached for 24 hours.

## Responsible data handling

- Only city names and favorite titles are sent to Qloo. No names, emails or device identifiers.
- The Qloo key stays on the server (Lovable Cloud secrets). It is never in the browser, the repository or any demo recording.
- Retries are limited to 2 and only for rate limits and server errors.

## Quality safeguards

- **Verified favorites:** a favorite is used only if Qloo's returned name matches what you typed ("Did you mean ...?" otherwise).
- **No lodging:** hotels, hostels, resorts and convention centers are excluded from all lists.
- **Right category:** a restaurant tagged "art gallery" does not appear under Culture.
- **Distinct explanations:** every card has its own tag-based sentence.
- **Visible warnings:** a step returning 0 results shows a warning in the trace, never "Done".

## Accessibility

Light and dark themes (system preference), AA contrast, status shown with icons and text, an `aria-live` region for the agent trace, labelled controls and tabs, visible focus, 44 px touch targets, `prefers-reduced-motion` respected.

## Tech

TanStack Start, React, Tailwind CSS, Lovable Cloud. Built with AI-assisted tools (Lovable, Claude), as allowed by the hackathon. MIT license, see [LICENSE](./LICENSE).
