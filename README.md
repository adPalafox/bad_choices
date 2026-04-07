# Bad Choices

Bad Choices is a lightweight social web game for fast group decisions. Players join a room with a code, secretly nominate the player most likely to make each scenario worse, vote on the public dilemma that nomination creates, and end each round with named blame.

## MVP included

- Anonymous nickname-based room join
- Shareable room code and direct room URL
- Host-controlled room start and rematch
- Realtime room sync with Supabase
- Timed secret picks, spotlight voting, instant reveal, and ending recap
- Three replayable starter scenario packs with modifiers, detours, and multiple endings:
  - `chaotic-friends`
  - `date-night-disaster`
  - `cursed-team-building`

## Stack

- `Next.js` app router
- `Supabase` for room state, votes, and realtime subscriptions
- Portable deploy shape that works on Netlify or Vercel

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

3. Link the repo to your Supabase project:

   ```bash
   npx supabase link --project-ref your-project-ref
   ```

4. Push the tracked migration history:

   ```bash
   npx supabase db push
   ```

   The deployable schema source of truth is [`supabase/migrations/20260404215317_init_schema.sql`](/Users/adreanpalafox/Developer/bad_choices/supabase/migrations/20260404215317_init_schema.sql). [`supabase/schema.sql`](/Users/adreanpalafox/Developer/bad_choices/supabase/schema.sql) is kept as a reference copy.

5. Start the app:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000)

## Automated e2e

The browser suite runs the production app (`next build` + `next start`) against a local Supabase stack.

1. Install Playwright browsers:

   ```bash
   npx playwright install chromium firefox webkit
   ```

2. Start and reset local Supabase:

   ```bash
   supabase start
   supabase db reset --local
   ```

3. Copy the example env file and replace the key placeholders with the values from `supabase status -o env`:

   ```bash
   cp .env.e2e.example .env.e2e
   ```

4. Run the smoke suite:

   ```bash
   npm run test:e2e:smoke
   ```

Useful commands:

- `npm run test:e2e`: full Playwright run
- `npm run test:e2e:full`: Chromium full suite plus Firefox/WebKit smoke
- `npm run test:ci`: lint, regression tests, pack validation, prod build, and Chromium smoke

## Core flow

1. Host creates a room and picks a scenario pack.
2. Players join with a nickname only.
3. Host starts once at least 3 players are present.
4. Each round starts with a private nomination prompt.
5. The room votes on a spotlighted public dilemma.
6. Reveal assigns outcome, blame, and receipt before the next round.
7. The room hits an ending card and can rematch instantly.

## Repo structure

- [`app`](/Users/adreanpalafox/Developer/bad_choices/app): routes, pages, and API handlers
- [`components`](/Users/adreanpalafox/Developer/bad_choices/components): landing and room UI
- [`content/packs`](/Users/adreanpalafox/Developer/bad_choices/content/packs): JSON scenario packs
- [`lib`](/Users/adreanpalafox/Developer/bad_choices/lib): game logic, Supabase clients, shared types
- [`supabase/migrations`](/Users/adreanpalafox/Developer/bad_choices/supabase/migrations): deployable database history for `supabase db push`
- [`supabase/schema.sql`](/Users/adreanpalafox/Developer/bad_choices/supabase/schema.sql): reference copy of the current schema

## Adding scenario packs

Scenario content is plain JSON. Each pack must define:

- `packId`
- `title`
- `theme`
- `startNodeId`
- `nodes[]`
- optional `modifiers[]`

Each node must define:

- `id`
- `prompt`
- `choices[]`
- optional `resultText`
- optional `ending`
- optional `kind`
- optional `gate`
- optional `promptVariants[]`
- optional `audienceInterventionNodeIds[]`
- optional `wildcardChance`
- optional `specialEventChance`
- optional `socialPrompt`

Each choice must define:

- `id`
- `label`
- `nextNodeId`
- optional `resultText`
- optional `gate`
- optional `effects[]`
- optional `wildcardNodeIds[]`
- optional `specialEventNodeIds[]`
- optional `labelVariants[]`

`socialPrompt` can define:

- `key`
- `prompt`
- `voteIntro`
- optional `receiptTemplate`

Scenario copy can also include spotlight placeholders that are resolved once the private nomination phase ends:

- `{{spotlight}}`
- `{{they}}`
- `{{them}}`
- `{{their}}`

Import the new pack in [`lib/content.ts`](/Users/adreanpalafox/Developer/bad_choices/lib/content.ts) so it appears in the host screen.

## Content depth standard

All packs are validated on load and should meet the current replayability floor:

- at least `18` nodes
- at least `5` endings
- minimum ending depth of `4` decisions from the pack opener
- no duplicate node ids or choice ids
- all `nextNodeId`, wildcard, special event, and audience intervention references must point to real nodes

The recommended structure is:

- `1` opener
- `3` first-branch nodes
- `6+` mid-run nodes
- `2+` detour nodes across wildcards, audience interventions, or special events
- `5+` endings

Replayability should come from both authored depth and reusable systems:

- modifiers applied by earlier choices that change later prompts or choice availability
- wildcard nodes that occasionally detour a run
- audience intervention nodes triggered by ties or no-vote chaos
- special event nodes that can interrupt a branch before it resolves into an ending

## Open-source notes

- No accounts are required in the MVP.
- All story packs are repo-managed content.
- All writes go through server routes; clients only subscribe to realtime updates and read public state.
- The current MVP keeps host authority minimal and uses deterministic tie-breaks by choice order.
- Database changes should be added as new files under `supabase/migrations/`, then applied with `npx supabase db push`.

## Validation checklist

- Create room and join from multiple browser tabs
- Confirm lobby sync works in realtime
- Start with 3 or more players
- Verify one private nomination per player per round
- Verify one public vote per player per round
- Verify reveal happens after timer expiry or all votes
- Verify rematch resets to lobby with the same pack
