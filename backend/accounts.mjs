import { scrypt, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const keyLength = 64;
const passwordSalt = 'whack-local-demo-v1';
const dummyHash = Buffer.alloc(keyLength);
const defaultPath = fileURLToPath(new URL('./data/accounts.sqlite', import.meta.url));

export function openAccounts(path = defaultPath) {
  const db = new DatabaseSync(path, { readOnly: true });

  const findUser = db.prepare(`
    SELECT user_id AS userId, name, password_hash AS hash,
           balance_minor AS balanceMinor, currency
    FROM users WHERE user_id = ?
  `);
  const findTransactions = db.prepare(`
    SELECT id, date, description, amount_minor AS amountMinor
    FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC
  `);

  return {
    async fetchAccount(userId, password) {
      const user = findUser.get(userId);
      const key = await deriveKey(password, passwordSalt, keyLength);
      const matches = timingSafeEqual(key, user?.hash ?? dummyHash);
      if (!user || !matches) return null;

      return {
        userId: user.userId,
        name: user.name,
        balanceMinor: user.balanceMinor,
        currency: user.currency,
        transactions: findTransactions.all(user.userId),
      };
    },
    close() {
      db.close();
    },
  };
}
