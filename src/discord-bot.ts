import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { Scraper, type TicketInfo } from "./scraper";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;

type WatchConfig = {
  eventId: string;
  channelId: string;
  pingUsers: string[];
  pollMinutes: number;
  scraper: Scraper;
};

export class DiscordBot {
  private client: Client;
  private watches = new Map<string, WatchConfig>();

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
  }

  async init() {
    await this.registerCommands();
    await this.client.login(DISCORD_TOKEN);

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleCommand(interaction);
    });

    console.log("Discord bot connected");
  }

  private async registerCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName("watch")
        .setDescription("Watch a Ticketmaster event for tickets")
        .addStringOption((opt) =>
          opt
            .setName("eventid")
            .setDescription("Ticketmaster event ID")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("users")
            .setDescription("User IDs to ping (comma-separated)")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("interval")
            .setDescription("Check interval in minutes (default: 5)")
            .setMinValue(1)
            .setMaxValue(60)
        ),
      new SlashCommandBuilder()
        .setName("list")
        .setDescription("List all active watches"),
      new SlashCommandBuilder()
        .setName("unwatch")
        .setDescription("Stop watching an event")
        .addStringOption((opt) =>
          opt
            .setName("eventid")
            .setDescription("Event ID to stop watching")
            .setRequired(true)
        ),
    ].map((cmd) => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Registered slash commands");
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    const { commandName } = interaction;

    if (commandName === "watch") {
      await this.handleWatch(interaction);
    } else if (commandName === "list") {
      await this.handleList(interaction);
    } else if (commandName === "unwatch") {
      await this.handleUnwatch(interaction);
    }
  }

  private async handleWatch(interaction: ChatInputCommandInteraction) {
    const eventId = interaction.options.getString("eventid", true);
    const usersStr = interaction.options.getString("users", true);
    const pollMinutes = interaction.options.getInteger("interval") ?? 5;

    if (this.watches.has(eventId)) {
      await interaction.reply({
        content: `Følger allerede event ${eventId}`,
        ephemeral: true,
      });
      return;
    }

    // Extract numeric IDs from mentions like <@123456789> or plain IDs
    const pingUsers = usersStr
      .split(",")
      .map((id) => id.trim().replace(/[<@!>]/g, ""))
      .filter((id) => id);

    const scraper = new Scraper({
      eventId,
      pollMinutes,
      onTicketsFound: (info) => this.notifyTickets(eventId, info),
    });

    this.watches.set(eventId, {
      eventId,
      channelId: interaction.channelId,
      pingUsers,
      pollMinutes,
      scraper,
    });

    scraper.start();

    const eventUrl = `https://www.ticketmaster.no/event/${eventId}`;
    const mentions = pingUsers.map((id) => `<@${id}>`).join(", ");
    const userCount = pingUsers.length;
    const userText = userCount === 1 ? "bruker" : "brukere";

    await interaction.reply(
      `Ny jobb: følger med på event ${eventUrl}, sjekker hvert ${pollMinutes} minutt\n` +
        `Vil pinge ${userCount} ${userText} (${mentions}) når resale-billetter blir tilgjengelig\n\n` +
        `Dette kjøres i bakgrunnen og stopper automatisk når billetter er funnet.\n` +
        `Bruk \`/list\` for å se alle aktive jobber, \`/unwatch\` for å stoppe`
    );
  }

  private async handleList(interaction: ChatInputCommandInteraction) {
    if (this.watches.size === 0) {
      await interaction.reply({
        content: "Ingen aktive jobber",
        ephemeral: true,
      });
      return;
    }

    const list = Array.from(this.watches.values())
      .map(
        (w) =>
          `**${w.eventId}**\n` +
          `  Kanal: <#${w.channelId}>\n` +
          `  Brukere: ${w.pingUsers.map((id) => `<@${id}>`).join(", ")}\n` +
          `  Intervall: ${w.pollMinutes}m`
      )
      .join("\n\n");

    await interaction.reply({
      content: `**Aktive jobber (${this.watches.size})**\n\n${list}`,
      ephemeral: true,
    });
  }

  private async handleUnwatch(interaction: ChatInputCommandInteraction) {
    const eventId = interaction.options.getString("eventid", true);
    const watch = this.watches.get(eventId);

    if (!watch) {
      await interaction.reply({
        content: `Følger ikke event ${eventId}`,
        ephemeral: true,
      });
      return;
    }

    await watch.scraper.stop();
    this.watches.delete(eventId);

    await interaction.reply(`Stoppet overvåking av event ${eventId}`);
  }

  private async notifyTickets(eventId: string, info: TicketInfo) {
    const watch = this.watches.get(eventId);
    if (!watch) return;

    const channel = await this.client.channels.fetch(watch.channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      console.error("Channel not found or not text-based");
      return;
    }

    const mentions = watch.pingUsers.map((id) => `<@${id}>`).join(" ");

    await channel.send(
      `${mentions}\n\n` +
        `**BILLETTER TILGJENGELIG**\n` +
        `Totalt billetter: **${info.totalTickets}**\n` +
        `Selgere: ${info.offers}\n` +
        `Maks billetter hos en selger: ${info.maxTickets}\n` +
        `Billigst: **${info.cheapest.toFixed(2)} NOK**\n` +
        `https://www.ticketmaster.no/event/${eventId}`
    );
  }
}
