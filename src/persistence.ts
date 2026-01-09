import { Database } from "bun:sqlite";
import { mkdir, chmod, access, constants, stat } from "fs/promises";
import { writeFile, unlink, rmdir } from "fs/promises";

// Ensure data directory exists with write permissions
const dataDir = "/app/data";
await mkdir(dataDir, { recursive: true });
try {
  await chmod(dataDir, 0o777);
} catch {
  // Ignore chmod errors (might not have permission to change)
}

// Verify we can actually write to the directory
try {
  const testFile = `${dataDir}/.write-test`;
  await writeFile(testFile, "");
  await unlink(testFile);
} catch (error) {
  throw new Error(
    `Cannot write to data directory ${dataDir}. Check volume mount permissions. Original error: ${error}`
  );
}

// Ensure database path is not a directory (can happen if accidentally created)
const dbPath = `${dataDir}/watches.db`;
try {
  const stats = await stat(dbPath);
  if (stats.isDirectory()) {
    console.warn(`Database path ${dbPath} exists as directory, removing...`);
    await rmdir(dbPath, { recursive: true });
  }
} catch {
  // File doesn't exist, which is fine
}

const db = new Database(dbPath);

export type WatchData = {
  eventId: string;
  channelId: string;
  pingUsers: string[];
  pollMinutes: number;
};

// Initialize database
db.run(`
  CREATE TABLE IF NOT EXISTS watches (
    event_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    ping_users TEXT NOT NULL,
    poll_minutes INTEGER NOT NULL
  )
`);

export function loadWatches(): WatchData[] {
  try {
    const rows = db.query("SELECT * FROM watches").all() as Array<{
      event_id: string;
      channel_id: string;
      ping_users: string;
      poll_minutes: number;
    }>;

    return rows.map((row) => ({
      eventId: row.event_id,
      channelId: row.channel_id,
      pingUsers: JSON.parse(row.ping_users),
      pollMinutes: row.poll_minutes,
    }));
  } catch (error) {
    console.error("Failed to load watches:", error);
    return [];
  }
}

export function saveWatch(watch: WatchData): void {
  try {
    db.run(
      `INSERT OR REPLACE INTO watches (event_id, channel_id, ping_users, poll_minutes)
       VALUES (?, ?, ?, ?)`,
      [
        watch.eventId,
        watch.channelId,
        JSON.stringify(watch.pingUsers),
        watch.pollMinutes,
      ]
    );
  } catch (error) {
    console.error("Failed to save watch:", error);
  }
}

export function deleteWatch(eventId: string): void {
  try {
    db.run("DELETE FROM watches WHERE event_id = ?", [eventId]);
  } catch (error) {
    console.error("Failed to delete watch:", error);
  }
}
