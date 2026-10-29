import { NextResponse } from 'next/server';

// Configuration presence only. It does not prove the services work.
export async function GET() {
  const has = (k: string) => Boolean(process.env[k]);
  return NextResponse.json({
    configured: {
      supabaseUrl: has('NEXT_PUBLIC_SUPABASE_URL'), supabaseAnonKey: has('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      supabaseServiceKey: has('SUPABASE_SERVICE_ROLE_KEY'), claude: has('ANTHROPIC_API_KEY'), slack: has('SLACK_BOT_TOKEN'),
    },
    connectionsTested: false,
  });
}
