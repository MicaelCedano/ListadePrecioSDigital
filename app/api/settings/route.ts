import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data, error } = await supabase.from('app_settings').select('*');
        if (error) throw error;

        const settings = data?.reduce((acc: any, curr: any) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {}) || {};

        console.log("GET /api/settings - Keys loaded:", Object.keys(settings));
        return NextResponse.json(settings);
    } catch (error) {
        console.error("GET /api/settings Error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function POST(req: Request) {
    let keyToLog = "unknown";
    try {
        const body = await req.json();
        const { key, value } = body;
        keyToLog = key || "missing";

        if (!key) {
            return NextResponse.json({ error: "Key is required" }, { status: 400 });
        }

        console.log(`POST /api/settings - Saving key: ${key}`);
        const { error } = await supabase
            .from('app_settings')
            .upsert({ key, value, updated_at: new Date().toISOString() });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`POST /api/settings Error [${keyToLog}]:`, error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
