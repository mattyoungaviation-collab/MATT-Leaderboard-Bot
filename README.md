# MATT Discord Verification and Leaderboard Bot

This bot:

- Verifies Ronin wallet ownership with a signed message
- Assigns one MATT holder role based on live wallet balance
- Tracks linked Discord users by wallet
- Displays Burn, Burn Flip, and Blackjack leaderboards
- Shows rewards only on the Burn leaderboard

## Burn rewards

1. 1,000,000 MATT
2. 800,000 MATT
3. 600,000 MATT
4. 500,000 MATT
5. 200,000 MATT

Total: 3,100,000 MATT per Burn competition period.

Burn Flip and Blackjack are activity-only leaderboards and give no rewards.

## Important security step

The bot token shown in the Discord screenshot was exposed. Reset it in the Discord Developer Portal before using this project. Never paste the replacement token into chat or commit it to GitHub.

## Local setup

1. Extract this ZIP.
2. Open PowerShell in the extracted folder.
3. Run:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run register
npm start
```

Put the new Discord bot token in `.env`.

## Discord role order

The bot's role must be above:

- MATT Legend
- MATT Elite
- MATT Holder

The bot needs Manage Roles, View Channels, Send Messages, Embed Links, Read Message History, and Use Application Commands.

## Render setup

Create a new Web Service from this project.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Add every `.env.example` value as a Render environment variable. Set `PUBLIC_BASE_URL` to the bot service's public Render URL.

For persistent wallet links, attach a Render disk and set:

```text
DATA_FILE=/var/data/matt-bot-state.json
```

## Required MATT website endpoints

The bot expects:

- `/api/burn/leaderboard?limit=100`
- `/api/burnflip/leaderboard?sort=flips-desc&limit=100`
- `/api/blackjack/leaderboard?sort=hands-desc&limit=100`

The current MATT site already has the Burn Flip leaderboard API, but it must support `flips-desc`. Burn and Blackjack leaderboard endpoints still need to be added to the live website server.

The bot safely keeps the last successful leaderboard data if one endpoint is temporarily unavailable.
