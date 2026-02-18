
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Fetch all inventory items
export async function GET() {
    try {
        const { data, error } = await supabase.from('inventory').select('*');
        if (error) throw error;
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// POST: Add or Update inventory item
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { id, brand, model, specs, price_float, price_str } = body;

        const { error } = await supabase
            .from('inventory')
            .upsert([{ id, brand, model, specs, price_float, price_str }]); // Using upsert for Insert or Replace logic

        if (error) {
            throw error;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// DELETE: Remove item
export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: "ID required" }, { status: 400 });
        }

        const { error } = await supabase
            .from('inventory')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
