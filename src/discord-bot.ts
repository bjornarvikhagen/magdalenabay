import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { Scraper, type TicketInfo } from "./scraper";
import {
  loadWatches,
  saveWatch,
  deleteWatch,
  type WatchData,
} from "./persistence";

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

    // Restore saved watches
    await this.restoreWatches();
  }

  private async restoreWatches() {
    const savedWatches = loadWatches();
    if (savedWatches.length === 0) {
      console.log("No saved watches to restore");
      return;
    }

    console.log(`Restoring ${savedWatches.length} saved watches...`);
    for (const watch of savedWatches) {
      this.startWatch(watch);
    }
  }

  private startWatch(watch: WatchData) {
    const scraper = new Scraper({
      eventId: watch.eventId,
      pollMinutes: watch.pollMinutes,
      onTicketsFound: (info) => this.notifyTickets(watch.eventId, info),
    });

    this.watches.set(watch.eventId, {
      ...watch,
      scraper,
    });

    scraper.start();
    console.log(`Started watching ${watch.eventId}`);
  }

  private persistWatch(watch: WatchData) {
    saveWatch(watch);
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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Extract numeric IDs from mentions like <@123456789> or plain IDs
    const pingUsers = usersStr
      .split(",")
      .map((id) => id.trim().replace(/[<@!>]/g, ""))
      .filter((id) => id);

    const watchData = {
      eventId,
      channelId: interaction.channelId,
      pingUsers,
      pollMinutes,
    };

    this.startWatch(watchData);
    this.persistWatch(watchData);

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
        flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleUnwatch(interaction: ChatInputCommandInteraction) {
    const eventId = interaction.options.getString("eventid", true);
    const watch = this.watches.get(eventId);

    if (!watch) {
      await interaction.reply({
        content: `Følger ikke event ${eventId}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Reply immediately, then stop scraper in background
    await interaction.reply(`Stopper overvåking av event ${eventId}...`);

    // Stop scraper without blocking
    watch.scraper.stop().catch((error) => {
      console.error(`Error stopping scraper for ${eventId}:`, error);
    });

    this.watches.delete(eventId);
    deleteWatch(eventId);
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
