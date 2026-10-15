import { createHash } from 'node:crypto';
import { adminToken } from './admin-token';
import { getPool } from './services';

// Salted with a server-only secret, so a stored hash cannot be matched against a list of Discord ids.
export const hashDiscordUser = (userId: string): string => createHash('sha256').update(`${adminToken()}:discord:${userId}`).digest('hex');

/** After someone signs in or links Discord, attach their earlier anonymous Discord votes to the account. */
export async function claimDiscordRatings(rogueUserId: number, discordId: string): Promise<void> {
  await getPool()!.query('UPDATE discord_answer_ratings SET user_id=$1 WHERE user_hash=$2 AND user_id IS NULL', [rogueUserId, hashDiscordUser(discordId)]);
}

