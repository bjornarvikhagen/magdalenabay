# Magdalena Bay Ticket Scraper

Discord bot that monitors Ticketmaster for resale tickets with slash commands.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create a Discord bot:
   - Go to https://discord.com/developers/applications
   - Create new application
   - Go to Bot section, create bot, copy token
   - Copy application ID from General Information
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Use Slash Commands`
   - Use generated URL to invite bot to server

3. Create `.env` file:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
```

4. Run:

```bash
bun run index.ts
```

## Commands

### `/watch <eventid> <users> [interval]`
Start watching a Ticketmaster event for tickets.

- `eventid`: Ticketmaster event ID (from URL)
- `users`: Comma-separated Discord user IDs to ping
- `interval`: Check interval in minutes (1-60, default: 5)

Example:
```
/watch eventid:1741098047 users:123456789,987654321 interval:10
```

### `/list`
Show all active watches with their configurations.

### `/unwatch <eventid>`
Stop watching an event.

Example:
```
/unwatch eventid:1741098047
```

## Finding IDs

- **Event ID**: From Ticketmaster URL `ticketmaster.no/event/[EVENT_ID]`
- **User ID**: Enable Developer Mode in Discord settings → right-click user → Copy ID
