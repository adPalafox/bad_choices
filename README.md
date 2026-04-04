# Bad Choices

Bad Choices is a lightweight social web game for fast group decisions. Players join a room with a code, vote on short scenario choices under a timer, and let the majority drag everyone to an ending worth blaming each other for.

## MVP included

- Anonymous nickname-based room join
- Shareable room code and direct room URL
- Host-controlled room start and rematch
- Realtime room sync with Supabase
- Timed voting, instant reveal, and ending recap
- Three starter scenario packs:
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

3. Create the Supabase schema by running [`supabase/schema.sql`](/Users/adreanpalafox/Developer/bad_choices/supabase/schema.sql) in the SQL editor.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Core flow

1. Host creates a room and picks a scenario pack.
2. Players join with a nickname only.
3. Host starts once at least 3 players are present.
4. Each round shows a short prompt and timed choices.
5. The majority vote decides the next branch.
6. The room hits an ending card and can rematch instantly.

## Repo structure

- [`app`](/Users/adreanpalafox/Developer/bad_choices/app): routes, pages, and API handlers
- [`components`](/Users/adreanpalafox/Developer/bad_choices/components): landing and room UI
- [`content/packs`](/Users/adreanpalafox/Developer/bad_choices/content/packs): JSON scenario packs
- [`lib`](/Users/adreanpalafox/Developer/bad_choices/lib): game logic, Supabase clients, shared types
- [`supabase/schema.sql`](/Users/adreanpalafox/Developer/bad_choices/supabase/schema.sql): schema and realtime policies

## Adding scenario packs

Scenario content is plain JSON. Each pack must define:

- `packId`
- `title`
- `theme`
- `startNodeId`
- `nodes[]`

Each node must define:

- `id`
- `prompt`
- `choices[]`
- optional `resultText`
- optional `ending`

Each choice must define:

- `id`
- `label`
- `nextNodeId`

Import the new pack in [`lib/content.ts`](/Users/adreanpalafox/Developer/bad_choices/lib/content.ts) so it appears in the host screen.

## Open-source notes

- No accounts are required in the MVP.
- All story packs are repo-managed content.
- All writes go through server routes; clients only subscribe to realtime updates and read public state.
- The current MVP keeps host authority minimal and uses deterministic tie-breaks by choice order.

## Validation checklist

- Create room and join from multiple browser tabs
- Confirm lobby sync works in realtime
- Start with 3 or more players
- Verify one vote per player per round
- Verify reveal happens after timer expiry or all votes
- Verify rematch resets to lobby with the same pack
