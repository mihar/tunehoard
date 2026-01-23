import * as fs from "fs";
import * as path from "path";

export class Database<T extends { id: number }> {
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

  public findById(id: number): T | undefined {
    const record = this.lookup.get(id);
    return record ? { ...record } : undefined;
  }

  public insert(record: T): T {
    const stored = { ...record };
    const existingIndex = this.items.findIndex(
      (item) => item.id === stored.id
    );

    if (existingIndex >= 0) {
      this.items[existingIndex] = stored;
    } else {
      this.items.push(stored);
    }

    this.lookup.set(stored.id, stored);
    this.persist();
    return { ...stored };
  }

  public update(
    id: number,
    updates: Partial<Omit<T, "id">>
  ): T {
    const existing = this.lookup.get(id);
    if (!existing) {
      throw new Error(`Record with id=${id} not found`);
    }

    const updated = { ...existing, ...updates };
    const index = this.items.findIndex(
      (record) => record.id === id
    );
    if (index !== -1) {
      this.items[index] = updated;
    }
    this.lookup.set(id, updated);
    this.persist();
    return { ...updated };
  }

  public delete(id: number): boolean {
    if (!this.lookup.has(id)) {
      return false;
    }

    this.lookup.delete(id);
    this.items = this.items.filter(
      (record) => record.id !== id
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
          nextLookup.set(stored.id, stored);
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
