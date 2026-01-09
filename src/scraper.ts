import { chromium, type Browser } from "playwright";

type Offer = {
  type: string;
  price?: { total: number };
  quantities?: number[];
};

export type TicketInfo = {
  eventId: string;
  totalTickets: number;
  offers: number;
  maxTickets: number;
  cheapest: number;
  cheapestQuantities: number[];
};

export type ScraperConfig = {
  eventId: string;
  pollMinutes: number;
  onTicketsFound: (info: TicketInfo) => void;
};

export class Scraper {
  private browser?: Browser;
  private running = false;
  private seen = false;
  private config: ScraperConfig;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    this.browser = await chromium.launch({ headless: true });

    const context = await this.browser.newContext({
      locale: "nb-NO",
      timezoneId: "Europe/Oslo",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    const pollMs = this.config.pollMinutes * 60 * 1000;
    const eventUrl = `https://www.ticketmaster.no/event/${this.config.eventId}`;

    while (this.running) {
      console.log(
        `[${this.config.eventId}] Loading event page (check every ${this.config.pollMinutes}m)…`
      );

      try {
        await page.goto(eventUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        await page.waitForTimeout(3000);

        const resaleData = await page.evaluate(async (eventId) => {
          try {
            const response = await fetch(
              `https://availability.ticketmaster.no/api/v2/TM_NO/resale/${eventId}`,
              {
                method: "GET",
                headers: {
                  Accept: "application/json",
                },
                credentials: "include",
              }
            );

            if (!response.ok) return null;
            return await response.json();
          } catch (e) {
            return null;
          }
        }, this.config.eventId);

        if (resaleData) {
          await this.processResaleData(resaleData);
        }
      } catch (error) {
        console.error(`[${this.config.eventId}] Error:`, error);
      }

      await page.waitForTimeout(pollMs);
    }
  }

  private async processResaleData(data: any) {
    const offers: Offer[] = data?.offers ?? [];

    const available = offers.some(
      (o) => o.type === "resale" && o.price?.total && o.quantities?.length
    );

    if (!available || this.seen) return;

    this.seen = true;

    const cheapest = offers.reduce((a, b) =>
      a.price!.total < b.price!.total ? a : b
    );

    const maxTickets = Math.max(...offers.flatMap((o) => o.quantities ?? [0]));
    const totalTickets = offers.reduce(
      (sum, o) => sum + Math.max(...(o.quantities ?? [0])),
      0
    );

    console.log(`TICKETS AVAILABLE [${this.config.eventId}]`);
    console.log(`Total tickets: ${totalTickets}`);
    console.log(`Offers: ${offers.length}`);
    console.log(`Max tickets: ${maxTickets}`);
    console.log(`Cheapest: ${(cheapest.price!.total / 100).toFixed(2)} NOK`);
    console.log(`Quantities: ${cheapest.quantities!.join(", ")}`);

    this.config.onTicketsFound({
      eventId: this.config.eventId,
      totalTickets,
      offers: offers.length,
      maxTickets,
      cheapest: cheapest.price!.total / 100,
      cheapestQuantities: cheapest.quantities!,
    });
  }

  async stop() {
    this.running = false;
    await this.browser?.close();
  }
}
