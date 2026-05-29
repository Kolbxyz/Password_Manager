import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import * as crypto from 'crypto';
import { dbManager } from './database';
import { crypt } from './crypt';

const app = express();
app.use(cors());
app.use(express.json());

// In-Memory Session Registry
interface Session {
  userId: number;
  username: string;
  masterKey: Buffer;
}
const sessions = new Map<string, Session>();

// --- AUTH MIDDLEWARE ---
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Access denied. Login required." });
  }

  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({ error: "Session expired or invalid." });
  }

  // Attach session parameters to request object
  (req as any).session = session;
  (req as any).token = token;
  next();
};

// --- REGISTER ROUTE ---
app.post('/api/auth/register', async (req, res) => {
  const { username, masterPassword } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters." });
  }
  if (!masterPassword || typeof masterPassword !== 'string' || masterPassword.length < 8) {
    return res.status(400).json({ error: "Master password must be at least 8 characters." });
  }

  try {
    const existing = dbManager.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: "Username is already taken." });
    }

    // Generate Salt & Derive Master Key
    const salt = crypt.generateSalt();
    const masterKey = await crypt.deriveKey(masterPassword, salt);

    // Create Verification Blob
    const verificationPayload = JSON.stringify({ verified: true });
    const encrypted = crypt.encrypt(verificationPayload, masterKey);
    const verificationBlob = JSON.stringify(encrypted);

    // Write User
    dbManager.createUser(username, salt, verificationBlob);
    
    // Wipe local buffers
    crypt.wipe(salt);
    crypt.wipe(masterKey);

    res.status(201).json({ success: true, message: "Account created successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Registration failed." });
  }
});

// --- LOGIN ROUTE ---
app.post('/api/auth/login', async (req, res) => {
  const { username, masterPassword } = req.body;

  if (!username || !masterPassword) {
    return res.status(400).json({ error: "Username and Master Password are required." });
  }

  try {
    const user = dbManager.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const salt = Buffer.from(user.master_salt, 'hex');
    const derivedKey = await crypt.deriveKey(masterPassword, salt);
    crypt.wipe(salt);

    // Verify derived key matches
    try {
      const encryptedData = JSON.parse(user.verification_blob);
      const decrypted = crypt.decrypt(
        encryptedData.encryptedData,
        derivedKey,
        encryptedData.iv,
        encryptedData.authTag
      );

      const parsed = JSON.parse(decrypted);
      if (!parsed || parsed.verified !== true) {
        throw new Error();
      }
    } catch (e) {
      crypt.wipe(derivedKey);
      return res.status(401).json({ error: "Invalid username or password." });
    }

    // Auth succeeded! Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      userId: user.id,
      username: user.username,
      masterKey: derivedKey
    });

    // Pre-populate folders if not present
    if (user.username === 'admin') {
      try {
        const entries = await dbManager.listEntries(user.id, derivedKey);
        
        // If there's an existing 'instacam', rename it to 'instagros' to update existing vaults
        for (const entry of entries) {
          if (entry.service.toLowerCase() === 'instacam') {
            await dbManager.updateEntry(user.id, derivedKey, entry.id, {
              service: 'instagros',
              username: entry.username,
              password: entry.password,
              notes: entry.notes || '',
              website: entry.website || '',
              totp: entry.totp || '',
              favorite: !!entry.favorite,
              folder: entry.folder || ''
            });
            entry.service = 'instagros'; // update in local array
          }
        }

        const hasSpecial = entries.some(e => ['revolol', 'palantar', 'macrosoft', 'instagros'].includes(e.service.toLowerCase()));
        if (!hasSpecial) {
          await dbManager.addEntry(user.id, derivedKey, { service: "revolol", username: "admin_revo", password: "rev-pass-123", folder: "Finance", favorite: true });
          await dbManager.addEntry(user.id, derivedKey, { service: "palantar", username: "admin_pal", password: "pal-pass-456", folder: "Work", favorite: false });
          await dbManager.addEntry(user.id, derivedKey, { service: "macrosoft", username: "admin_mac", password: "mac-pass-789", folder: "Personal", favorite: true });
          await dbManager.addEntry(user.id, derivedKey, { service: "instagros", username: "admin_insta", password: "ins-pass-000", folder: "Social", favorite: false });
        }
      } catch (e) {
        console.error("Failed to pre-populate admin entries:", e);
      }
    }

    res.json({ success: true, token, username: user.username });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Login failed." });
  }
});

// --- LOGOUT ROUTE ---
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = (req as any).token;
  const session = sessions.get(token);
  
  if (session) {
    crypt.wipe(session.masterKey);
    sessions.delete(token);
  }
  
  res.json({ success: true, message: "Logged out successfully." });
});

// --- LIST ENTRIES ---
app.get('/api/entries', requireAuth, async (req, res) => {
  const { userId, masterKey } = (req as any).session;
  try {
    const entries = await dbManager.listEntries(userId, masterKey);
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to list entries" });
  }
});

// --- ADD ENTRY ---
app.post('/api/entries', requireAuth, async (req, res) => {
  const { userId, masterKey } = (req as any).session;
  const { service, username, password, notes, website } = req.body;

  if (!service || !username) {
    return res.status(400).json({ error: "Service name and username are required." });
  }

  try {
    const id = await dbManager.addEntry(userId, masterKey, { service, username, password, notes, website });
    res.status(201).json({ id, service, username, password, notes, website });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add entry" });
  }
});

// --- UPDATE ENTRY ---
app.put('/api/entries/:id', requireAuth, async (req, res) => {
  const { userId, masterKey } = (req as any).session;
  const id = parseInt(req.params.id as string, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid entry ID." });
  }

  const { service, username, password, notes, website } = req.body;
  if (!service || !username) {
    return res.status(400).json({ error: "Service name and username are required." });
  }

  try {
    const updated = await dbManager.updateEntry(userId, masterKey, id, { service, username, password, notes, website });
    if (updated) {
      res.json({ id, service, username, password, notes, website });
    } else {
      res.status(404).json({ error: "Entry not found or unauthorized." });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update entry" });
  }
});

// --- DELETE ENTRY ---
app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  const { userId } = (req as any).session;
  const id = parseInt(req.params.id as string, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid entry ID." });
  }

  try {
    const deleted = await dbManager.deleteEntry(userId, id);
    if (deleted) {
      res.json({ success: true, message: "Entry deleted successfully." });
    } else {
      res.status(404).json({ error: "Entry not found or unauthorized." });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to delete entry" });
  }
});

// --- CHANGE PASSWORD ---
app.post('/api/settings/change-password', requireAuth, async (req, res) => {
  const { userId, masterKey: currentMasterKey } = (req as any).session;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "Invalid password fields. New password must be at least 8 characters." });
  }

  try {
    const user = dbManager.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const salt = Buffer.from(user.master_salt, 'hex');
    const derivedVerifyKey = await crypt.deriveKey(currentPassword, salt);
    crypt.wipe(salt);

    // Verify current password correctness
    try {
      const encryptedData = JSON.parse(user.verification_blob);
      const decrypted = crypt.decrypt(
        encryptedData.encryptedData,
        derivedVerifyKey,
        encryptedData.iv,
        encryptedData.authTag
      );

      const parsed = JSON.parse(decrypted);
      if (!parsed || parsed.verified !== true) {
        throw new Error();
      }
    } catch (e) {
      crypt.wipe(derivedVerifyKey);
      return res.status(401).json({ error: "Incorrect current master password." });
    }
    crypt.wipe(derivedVerifyKey);

    // Correct password! Decrypt all existing user entries
    const entries = await dbManager.listEntries(userId, currentMasterKey);

    // Setup new master password
    const newSalt = crypt.generateSalt();
    const newMasterKey = await crypt.deriveKey(newPassword, newSalt);

    const verificationPayload = JSON.stringify({ verified: true });
    const encrypted = crypt.encrypt(verificationPayload, newMasterKey);
    const newVerificationBlob = JSON.stringify(encrypted);

    // Save user metadata updates
    dbManager.updateUserVerification(userId, newSalt, newVerificationBlob);

    // Re-encrypt and rewrite user entries
    dbManager.updateDecryptedEntries(userId, newMasterKey, entries);

    // Update active session's masterKey to new masterKey
    crypt.wipe(currentMasterKey);
    (req as any).session.masterKey = newMasterKey;

    crypt.wipe(newSalt);

    res.json({ success: true, message: "Master password changed successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to change master password." });
  }
});

// --- WIPE ACCOUNT ---
app.post('/api/settings/wipe', requireAuth, (req, res) => {
  const { userId, masterKey } = (req as any).session;
  const token = (req as any).token;

  try {
    dbManager.wipeUser(userId);
    
    // Revoke session
    crypt.wipe(masterKey);
    sessions.delete(token);

    res.json({ success: true, message: "Account and all entries deleted permanently." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Account deletion failed." });
  }
});

// Serve frontend static assets
const publicPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '../src/public');

app.use(express.static(publicPath));

// Fallback to index.html for SPA router
app.use((req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(publicPath, 'index.html'));
  } else {
    res.status(404).json({ error: "API endpoint not found" });
  }
});

export const server = {
  start(port: number = 3000) {
    return app.listen(port, () => {
      console.log(`=========================================`);
      console.log(`🔐 Password Manager Server running on:    `);
      console.log(`   👉 http://localhost:${port}          `);
      console.log(`=========================================`);
    });
  }
};
