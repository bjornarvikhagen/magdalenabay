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

    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
    });

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
        console.log(`[${this.config.eventId}] Navigating to ${eventUrl}`);
        const response = await page.goto(eventUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        console.log(
          `[${this.config.eventId}] Page loaded, status: ${response?.status()}`
        );

        // Give page time to fully settle
        console.log(
          `[${this.config.eventId}] Waiting 5s for page to settle...`
        );
        await page.waitForTimeout(5000);

        console.log(
          `[${this.config.eventId}] Starting browser-context fetch...`
        );

        // Fetch resale data directly from browser context
        const resaleData = await page.evaluate(async (eventId) => {
          try {
            const url = `https://availability.ticketmaster.no/api/v2/TM_NO/resale/${eventId}`;
            console.log("[Browser] Fetching:", url);

            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
              },
              credentials: "include",
            });

            console.log("[Browser] Response status:", response.status);
            console.log(
              "[Browser] Response headers:",
              JSON.stringify([...response.headers.entries()])
            );

            if (!response.ok) {
              const text = await response.text();
              console.log(
                "[Browser] Response not OK:",
                response.status,
                response.statusText,
                "Body:",
                text.substring(0, 500)
              );
              return { error: true, status: response.status, body: text };
            }

            const data = await response.json();
            console.log(
              "[Browser] Got data with",
              data?.offers?.length || 0,
              "offers"
            );
            console.log(
              "[Browser] Full response:",
              JSON.stringify(data).substring(0, 1000)
            );
            return data;
          } catch (e) {
            console.error(
              "[Browser] Fetch error:",
              e instanceof Error ? e.message : String(e)
            );
            console.error(
              "[Browser] Fetch error stack:",
              e instanceof Error ? e.stack : ""
            );
            return {
              error: true,
              message: e instanceof Error ? e.message : String(e),
            };
          }
        }, this.config.eventId);

        console.log(
          `[${this.config.eventId}] Fetch complete, processing result...`
        );
        console.log(`[${this.config.eventId}] Result type:`, typeof resaleData);
        console.log(
          `[${this.config.eventId}] Result keys:`,
          resaleData ? Object.keys(resaleData) : "null"
        );

        if (resaleData && !resaleData.error) {
          console.log(`[${this.config.eventId}] Processing resale data...`);
          await this.processResaleData(resaleData);
        } else if (resaleData && resaleData.error) {
          console.log(
            `[${this.config.eventId}] API returned error:`,
            JSON.stringify(resaleData)
          );
        } else {
          console.log(
            `[${this.config.eventId}] No resale data found (null/undefined)`
          );
        }
      } catch (error) {
        console.error(`[${this.config.eventId}] Error:`, error);

        // If browser died, try to restart
        if (!this.browser?.isConnected()) {
          console.log(
            `[${this.config.eventId}] Browser disconnected, stopping`
          );
          this.running = false;
          break;
        }
      }

      if (this.running) {
        await page.waitForTimeout(pollMs);
      }
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
