import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const folder = new URL("./", import.meta.url);
const { entries } = JSON.parse(
  readFileSync(new URL("meta/_journal.json", folder), "utf8"),
);

// Mirrors Drizzle's timestamp cutoff and statement boundaries, without any
// application dependencies or access to configured database paths.
function migrate(db, migrations = entries) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  const last =
    db
      .prepare(
        "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      )
      .get()?.created_at ?? -1;
  const pending = migrations.filter((entry) => entry.when > last);
  db.exec("BEGIN");
  try {
    for (const entry of pending) {
      const sql = readFileSync(new URL(`${entry.tag}.sql`, folder), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        db.exec(statement);
      }
      db.prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      ).run(createHash("sha256").update(sql).digest("hex"), entry.when);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return pending.map((entry) => entry.tag);
}

test("deployed migration timestamps stay fixed and auth follows them", () => {
  assert.deepEqual(
    entries.slice(94).map(({ idx, when, tag }) => ({ idx, when, tag })),
    [
      { idx: 94, when: 1785820790252, tag: "0094_great_thunderball" },
      { idx: 95, when: 1786341838287, tag: "0095_absurd_ravenous" },
      { idx: 96, when: 1786341838288, tag: "0096_migrate_to_better_auth" },
    ],
  );
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i].when > entries[i - 1].when);
  }
});

for (const existing of [false, true]) {
  test(
    existing
      ? "existing fork preserves credentials, bookmarks and runtime secrets"
      : "fresh database applies the entire migration history",
    () => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec("PRAGMA foreign_keys = ON");
        if (existing) {
          migrate(db, entries.slice(0, 96));
          db.exec(`
          INSERT INTO user (id, name, email, password, salt, emailVerified)
          VALUES ('u1', 'Legacy', 'Legacy@Example.com', 'legacy-hash', 'legacy-salt', 1700000000000);
          INSERT INTO bookmarks (id, createdAt, userId) VALUES ('b1', 1700000000, 'u1');
          INSERT INTO bookmarkLinks (id, url, crawlErrorSource, crawlErrorCode, crawlErrorMessage, crawlErrorRetryable, crawlErrorAt)
          VALUES ('b1', 'https://example.com', 'link_resolver', 'COOKIE_EXPIRED', 'expired', 0, 1700000000);
          INSERT INTO resolverRuntimeConfig (resolverId, key, value, createdAt, updatedBy)
          VALUES ('resolver', 'cookie', 'private-secret', 1700000000, 'u1');
        `);
          const history = db
            .prepare("SELECT * FROM __drizzle_migrations ORDER BY id")
            .all();
          assert.deepEqual(migrate(db), ["0096_migrate_to_better_auth"]);
          assert.deepEqual(
            db
              .prepare(
                "SELECT * FROM __drizzle_migrations ORDER BY id LIMIT 96",
              )
              .all(),
            history,
          );
          const user = db.prepare("SELECT * FROM user WHERE id = 'u1'").get();
          assert.equal(user.email, "legacy@example.com");
          assert.equal(user.emailVerified, 1);
          assert.ok(user.createdAt > 0);
          assert.equal("password" in user, false);
          assert.equal("salt" in user, false);
          const credential = db
            .prepare("SELECT * FROM account WHERE userId = 'u1'")
            .get();
          assert.equal(credential.providerId, "credential");
          assert.equal(
            credential.password,
            "bcrypt-salted:legacy-salt:legacy-hash",
          );
          assert.equal(
            db.prepare("SELECT userId FROM bookmarks WHERE id = 'b1'").get()
              .userId,
            "u1",
          );
          assert.equal(
            db
              .prepare(
                "SELECT crawlErrorCode FROM bookmarkLinks WHERE id = 'b1'",
              )
              .get().crawlErrorCode,
            "COOKIE_EXPIRED",
          );
          assert.equal(
            db.prepare("SELECT value FROM resolverRuntimeConfig").get().value,
            "private-secret",
          );
        } else {
          assert.equal(migrate(db).length, 97);
        }
        assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
        assert.equal(
          db.prepare("PRAGMA integrity_check").get().integrity_check,
          "ok",
        );
        assert.deepEqual(migrate(db), []);
      } finally {
        db.close();
      }
    },
  );
}
