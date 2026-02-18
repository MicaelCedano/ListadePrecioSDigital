
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  // Warn instead of throw to allow build to pass in CI/CD without secrets
  console.warn('Missing Supabase environment variables. API calls will fail.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
