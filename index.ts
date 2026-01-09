import { DiscordBot } from "./src/discord-bot";

async function main() {
  const bot = new DiscordBot();
  await bot.init();
}

main().catch(console.error);
