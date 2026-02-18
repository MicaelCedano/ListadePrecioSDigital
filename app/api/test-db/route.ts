
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    console.log("Checking DB connection...");

    // Check if variables are loaded (Server Side)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'Missing';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'Missing'; // Don't expose this normally, but for debug

    // Attempt a query
    try {
        const { data, error } = await supabase.from('brands').select('count', { count: 'exact', head: true });

        if (error) {
            return NextResponse.json({
                status: 'error',
                message: error.message,
                code: error.code,
                env: {
                    url_status: url === 'Missing' ? 'Missing' : 'Present',
                    key_status: key === 'Missing' ? 'Missing' : 'Present (Starts with ' + key.substring(0, 5) + '...)'
                }
            }, { status: 500 });
        }

        return NextResponse.json({
            status: 'success',
            message: 'Connected to Supabase successfully!',
            data: data
        });

    } catch (e: any) {
        return NextResponse.json({
            status: 'crash',
            message: e.message,
            stack: e.stack
        }, { status: 500 });
    }
}
