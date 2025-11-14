import * as fs from "fs";
import * as path from "path";

export class Database<T extends { telegramUserId: number }> {
  private readonly filePath: string;
  private items: T[] = [];
  private lookup: Map<number, T> = new Map();

  constructor(filePath?: string) {
    this.filePath = filePath
      ? path.resolve(filePath)
      : path.resolve(process.cwd(), "storage", "data.jsonl");

    this.loadFromDisk();
  }

  public findAll(): T[] {
    return this.items.map((record) => ({ ...record }));
  }

  public findById(telegramUserId: number): T | undefined {
    const record = this.lookup.get(telegramUserId);
    return record ? { ...record } : undefined;
  }

  public insert(record: T): T {
    const stored = { ...record };
    const existingIndex = this.items.findIndex(
      (item) => item.telegramUserId === stored.telegramUserId
    );

    if (existingIndex >= 0) {
      this.items[existingIndex] = stored;
    } else {
      this.items.push(stored);
    }

    this.lookup.set(stored.telegramUserId, stored);
    this.persist();
    return { ...stored };
  }

  public update(
    telegramUserId: number,
    updates: Partial<Omit<T, "telegramUserId">>
  ): T {
    const existing = this.lookup.get(telegramUserId);
    if (!existing) {
      throw new Error(`Record with telegramUserId=${telegramUserId} not found`);
    }

    const updated = { ...existing, ...updates };
    const index = this.items.findIndex(
      (record) => record.telegramUserId === telegramUserId
    );
    if (index !== -1) {
      this.items[index] = updated;
    }
    this.lookup.set(telegramUserId, updated);
    this.persist();
    return { ...updated };
  }

  public delete(telegramUserId: number): boolean {
    if (!this.lookup.has(telegramUserId)) {
      return false;
    }

    this.lookup.delete(telegramUserId);
    this.items = this.items.filter(
      (record) => record.telegramUserId !== telegramUserId
    );
    this.persist();
    return true;
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const fileContents = fs.readFileSync(this.filePath, "utf-8");
      const nextItems: T[] = [];
      const nextLookup: Map<number, T> = new Map();

      fileContents.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        try {
          const parsed = JSON.parse(trimmed) as T;
          const stored = { ...parsed };
          nextItems.push(stored);
          nextLookup.set(stored.telegramUserId, stored);
        } catch (err) {
          console.warn(
            `Skipping invalid JSON in ${this.filePath} at line ${index + 1}:`,
            err
          );
        }
      });

      this.items = nextItems;
      this.lookup = nextLookup;
    } catch (error) {
      console.error(`Failed to read database file ${this.filePath}:`, error);
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data =
      this.items.map((record) => JSON.stringify(record)).join("\n") +
      (this.items.length ? "\n" : "");
    fs.writeFileSync(this.filePath, data, "utf-8");
  }
}

export default Database;
