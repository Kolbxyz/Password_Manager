import { DatabaseSync } from 'node:sqlite';
import { crypt } from './crypt';

const DB_PATH = './passwords.db';

export interface PasswordEntry {
  id?: number;
  service: string;
  username: string;
  password?: string;
  notes?: string;
  website?: string;
  totp?: string;       // Base32 TOTP secret key
  favorite?: boolean;  // Starred indicator
  folder?: string;     // Grouping folder (Work, Personal, Social, Finance)
}

export interface User {
  id: number;
  username: string;
  master_salt: string;
  verification_blob: string;
}

export class DatabaseManager {
  private db: DatabaseSync | null = null;

  async init(): Promise<void> {
    this.db = new DatabaseSync(DB_PATH);

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        master_salt TEXT,
        verification_blob TEXT
      );
    `);

    // Check if entries table exists
    const checkTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'").get() as { name: string } | undefined;

    if (!checkTable) {
      // Clean install
      this.db.exec(`
        CREATE TABLE entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          encrypted_blob TEXT,
          iv TEXT,
          auth_tag TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    } else {
      // Table exists. Let's check for user_id column (migration check)
      const columns = this.db.prepare("PRAGMA table_info(entries)").all() as any[];
      const hasUserId = columns.some(col => col.name === 'user_id');

      if (!hasUserId) {
        console.log("Migrating database schema to support multi-user accounts...");
        
        let salt = crypt.generateSalt().toString('hex');
        let verificationBlob = "";

        const checkMetadataTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get() as { name: string } | undefined;
        if (checkMetadataTable) {
          try {
            const saltRow = this.db.prepare("SELECT value FROM metadata WHERE key = 'master_salt'").get() as { value: string } | undefined;
            if (saltRow) salt = saltRow.value;
            
            const verificationRow = this.db.prepare("SELECT value FROM metadata WHERE key = 'verification_blob'").get() as { value: string } | undefined;
            if (verificationRow) verificationBlob = verificationRow.value;
          } catch (e) {
            console.error("Error reading old metadata:", e);
          }
        }

        // Insert default admin user (id = 1)
        this.db.prepare(`
          INSERT OR IGNORE INTO users (id, username, master_salt, verification_blob)
          VALUES (1, 'admin', ?, ?)
        `).run(salt, verificationBlob);

        // Alter the entries table to add user_id referencing admin user
        this.db.exec(`
          ALTER TABLE entries ADD COLUMN user_id INTEGER DEFAULT 1;
        `);

        // Drop metadata table to clean up
        if (checkMetadataTable) {
          this.db.exec("DROP TABLE metadata;");
        }

        console.log("Migration complete!");
      }
    }
  }

  // --- USER OPERATIONS ---

  getUserByUsername(username: string): User | null {
    if (!this.db) throw new Error("Database not initialized.");
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase()) as any as User | undefined;
    return row || null;
  }

  getUserById(id: number): User | null {
    if (!this.db) throw new Error("Database not initialized.");
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any as User | undefined;
    return row || null;
  }

  createUser(username: string, salt: Buffer, verificationBlob: string): number {
    if (!this.db) throw new Error("Database not initialized.");
    
    const stmt = this.db.prepare(`
      INSERT INTO users (username, master_salt, verification_blob)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(username.trim().toLowerCase(), salt.toString('hex'), verificationBlob) as { lastInsertRowid: number };
    return Number(result.lastInsertRowid);
  }

  updateUserVerification(userId: number, salt: Buffer, verificationBlob: string): boolean {
    if (!this.db) throw new Error("Database not initialized.");
    const stmt = this.db.prepare('UPDATE users SET master_salt = ?, verification_blob = ? WHERE id = ?');
    const result = stmt.run(salt.toString('hex'), verificationBlob, userId) as { changes: number };
    return Number(result.changes) > 0;
  }

  wipeUser(userId: number): boolean {
    if (!this.db) throw new Error("Database not initialized.");
    
    const deleteEntries = this.db.prepare('DELETE FROM entries WHERE user_id = ?');
    deleteEntries.run(userId);

    const deleteUser = this.db.prepare('DELETE FROM users WHERE id = ?');
    const result = deleteUser.run(userId) as { changes: number };
    
    return Number(result.changes) > 0;
  }

  // --- PASSWORD ENTRIES (Scoped per User) ---

  async addEntry(userId: number, masterKey: Buffer, entry: Omit<PasswordEntry, 'id'>): Promise<number> {
    if (!this.db) throw new Error("Database not initialized.");

    const fullData = JSON.stringify({
      service: entry.service,
      username: entry.username,
      password: entry.password || "",
      notes: entry.notes || "",
      website: entry.website || "",
      totp: entry.totp || "",
      favorite: !!entry.favorite,
      folder: entry.folder || ""
    });
    const encrypted = crypt.encrypt(fullData, masterKey);

    const stmt = this.db.prepare(`
      INSERT INTO entries (user_id, encrypted_blob, iv, auth_tag)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(userId, encrypted.encryptedData, encrypted.iv, encrypted.authTag) as { lastInsertRowid: number };
    return Number(result.lastInsertRowid);
  }

  async updateEntry(userId: number, masterKey: Buffer, id: number, entry: Omit<PasswordEntry, 'id'>): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized.");

    // Verify row belongs to user
    const row = this.db.prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) return false;

    const fullData = JSON.stringify({
      service: entry.service,
      username: entry.username,
      password: entry.password || "",
      notes: entry.notes || "",
      website: entry.website || "",
      totp: entry.totp || "",
      favorite: !!entry.favorite,
      folder: entry.folder || ""
    });
    const encrypted = crypt.encrypt(fullData, masterKey);

    const stmt = this.db.prepare(`
      UPDATE entries
      SET encrypted_blob = ?, iv = ?, auth_tag = ?
      WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(encrypted.encryptedData, encrypted.iv, encrypted.authTag, id, userId) as { changes: number };
    return Number(result.changes) > 0;
  }

  async deleteEntry(userId: number, id: number): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized.");
    
    const stmt = this.db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?');
    const result = stmt.run(id, userId) as { changes: number };
    return Number(result.changes) > 0;
  }

  async listEntries(userId: number, masterKey: Buffer): Promise<PasswordEntry[]> {
    if (!this.db) throw new Error("Database not initialized.");

    const rows = this.db.prepare('SELECT * FROM entries WHERE user_id = ?').all(userId) as any[];

    return rows.map((row) => {
      try {
        const decryptedJson = crypt.decrypt(
          row.encrypted_blob,
          masterKey,
          row.iv,
          row.auth_tag
        );
        const parsed = JSON.parse(decryptedJson);
        return {
          id: Number(row.id),
          service: parsed.service || "",
          username: parsed.username || "",
          password: parsed.password || "",
          notes: parsed.notes || "",
          website: parsed.website || "",
          totp: parsed.totp || "",
          favorite: !!parsed.favorite,
          folder: parsed.folder || ""
        };
      } catch (err) {
        return {
          id: Number(row.id),
          service: "[DECRYPTION FAILED]",
          username: "[DECRYPTION FAILED]"
        };
      }
    });
  }

  updateDecryptedEntries(userId: number, newMasterKey: Buffer, entries: PasswordEntry[]): void {
    if (!this.db) throw new Error("Database not initialized.");

    // Delete existing
    const deleteStmt = this.db.prepare('DELETE FROM entries WHERE user_id = ?');
    deleteStmt.run(userId);

    // Insert re-encrypted
    const insertStmt = this.db.prepare(`
      INSERT INTO entries (user_id, encrypted_blob, iv, auth_tag)
      VALUES (?, ?, ?, ?)
    `);

    for (const entry of entries) {
      const fullData = JSON.stringify({
        service: entry.service,
        username: entry.username,
        password: entry.password || "",
        notes: entry.notes || "",
        website: entry.website || "",
        totp: entry.totp || "",
        favorite: !!entry.favorite,
        folder: entry.folder || ""
      });
      const encrypted = crypt.encrypt(fullData, newMasterKey);
      insertStmt.run(userId, encrypted.encryptedData, encrypted.iv, encrypted.authTag);
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {}
      this.db = null;
    }
  }
}

export const dbManager = new DatabaseManager();
