import * as crypto from 'crypto';
import * as argon2 from 'argon2';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

// A "Pepper" is a secret hardcoded in your app (or an environment variable).
// An attacker needs BOTH the database AND this code to start cracking.
const PEPPER = Buffer.from('7f8624637f9850604111306f4c9c61f22445e998', 'hex');

export class Crypt {
  /**
   * Derives a key using Master Password + Salt + Pepper.
   */
  async deriveKey(masterPassword: string, salt: Buffer): Promise<Buffer> {
    // We combine the password and pepper for extra security
    const passwordWithPepper = Buffer.concat([
      Buffer.from(masterPassword),
      PEPPER
    ]);

    const key = await argon2.hash(passwordWithPepper, {
      salt,
      raw: true,
      type: argon2.argon2id,
      hashLength: 32,
    });

    // Security: Clear the temporary buffer containing the peppered password
    passwordWithPepper.fill(0);

    return key;
  }

  encrypt(plaintext: string, key: Buffer): { iv: string; encryptedData: string; authTag: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted,
      authTag: authTag,
    };
  }

  decrypt(encryptedData: string, key: Buffer, ivHex: string, authTagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  generateSalt(): Buffer {
    return crypto.randomBytes(SALT_LENGTH);
  }

  /**
   * "Zero-out" a Buffer to remove sensitive data from RAM.
   */
  wipe(buf: Buffer | null) {
    if (buf) buf.fill(0);
  }
}

export const crypt = new Crypt();
