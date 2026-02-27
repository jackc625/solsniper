import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent creator blocklist backed by a local JSON file.
 * Grows over time as confirmed rug creators are added.
 * On startup, load() reads the file to restore previously added entries.
 */
export class Blocklist {
  private readonly filePath: string;
  private readonly entries: Set<string> = new Set();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Reads the JSON file at filePath and populates the internal set.
   * If the file does not exist, starts with an empty set (no error thrown).
   */
  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as string[];
      for (const address of parsed) {
        this.entries.add(address);
      }
    } catch {
      // File doesn't exist yet — start empty
    }
  }

  /**
   * Returns true if the given address is on the blocklist.
   */
  has(address: string): boolean {
    return this.entries.has(address);
  }

  /**
   * Adds an address to the blocklist and immediately persists to disk.
   * Creates the directory if it does not exist.
   */
  add(address: string): void {
    this.entries.add(address);
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify([...this.entries], null, 2));
  }

  /**
   * Number of addresses currently in the blocklist.
   */
  get size(): number {
    return this.entries.size;
  }
}
