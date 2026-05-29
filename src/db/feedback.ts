import { getSupabase } from './client.js';

export async function insertFeedback(entry: {
  userId: string;
  rating?: 'up' | 'down';
  stars?: number;
  intent?: string;
  comment?: string;
}): Promise<void> {
  const { error } = await getSupabase().from('feedback_logs').insert({
    user_id: entry.userId,
    rating: entry.rating,
    stars: entry.stars,
    intent: entry.intent,
    comment: entry.comment,
  });
  if (error) throw error;
}
