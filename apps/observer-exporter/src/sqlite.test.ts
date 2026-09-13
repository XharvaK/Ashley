import { readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { backupDatabase, openReadOnlyDatabase } from "./sqlite.js";
import { createNuclearFixture, removeTemp, tempDir } from "../../../test/observer-support.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) removeTemp(path);
});

describe("read-only SQLite observation", () => {
  it("opens the source read-only and rejects source mutation", () => {
    const dir = tempDir("observer-sqlite-");
    temporaryPaths.push(dir);
    const sourcePath = `${dir}/nuclear.db`;
    const writer = createNuclearFixture(sourcePath);
    writer.close();
    const source = openReadOnlyDatabase(sourcePath);
    expect(() => source.exec("INSERT INTO mem_messages VALUES (1, 't', 'o', 'user', 'bad', 'discord', '2026-08-26T01:00:00.000Z', 'never_public')")).toThrow();
    source.close();
  });

  it("uses the SQLite backup API and leaves source bytes and rows unchanged", async () => {
    const dir = tempDir("observer-sqlite-backup-");
    temporaryPaths.push(dir);
    const sourcePath = `${dir}/nuclear.db`;
    const snapshotPath = `${dir}/snapshot.db`;
    const writer = createNuclearFixture(sourcePath);
    writer.prepare("INSERT INTO mem_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      1,
      "thread-1",
      "owner-1",
      "user",
      "hello",
      "discord",
      "2026-08-26T01:00:00.000Z",
      "never_public",
    );
    writer.close();
    const before = readFileSync(sourcePath);
    await backupDatabase(sourcePath, snapshotPath);
    const snapshot = openReadOnlyDatabase(snapshotPath);
    expect(snapshot.prepare("SELECT count(*) AS count FROM mem_messages").get()).toEqual({ count: 1 });
    snapshot.close();
    expect(readFileSync(sourcePath)).toEqual(before);
    rmSync(snapshotPath, { force: true });
  });

  it("backs up a WAL-mode source consistently while a writer is open", async () => {
    const dir = tempDir("observer-sqlite-wal-");
    temporaryPaths.push(dir);
    const sourcePath = `${dir}/nuclear.db`;
    const snapshotPath = `${dir}/wal-snapshot.db`;
    const writer = new DatabaseSync(sourcePath);
    writer.exec("PRAGMA journal_mode = WAL; CREATE TABLE events(id INTEGER PRIMARY KEY, value TEXT);");
    writer.prepare("INSERT INTO events(value) VALUES (?)").run("committed-in-wal");
    await backupDatabase(sourcePath, snapshotPath);
    const snapshot = openReadOnlyDatabase(snapshotPath);
    expect(snapshot.prepare("SELECT value FROM events").all()).toEqual([
      { value: "committed-in-wal" },
    ]);
    snapshot.close();
    writer.close();
    rmSync(snapshotPath, { force: true });
  });
});
