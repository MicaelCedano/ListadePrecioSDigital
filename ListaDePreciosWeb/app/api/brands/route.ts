
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Fetch all brands
export async function GET() {
    try {
        const { data, error } = await supabase
            .from('brands')
            .select('*')
            .order('order_index', { ascending: true });

        if (error) throw error;

        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// POST: Add new brand
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, color } = body;

        // Get count for order index
        const { count, error: countError } = await supabase
            .from('brands')
            .select('*', { count: 'exact', head: true });

        if (countError) throw countError;

        const { error } = await supabase
            .from('brands')
            .insert([{ name, color, order_index: count }]);

        if (error) {
            if (error.code === '23505') { // Unique violation
                return NextResponse.json({ error: "La marca ya existe" }, { status: 400 });
            }
            throw error;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// PUT: Reorder or update brands
export async function PUT(req: Request) {
    try {
        const body = await req.json();
        const { action, brands: orderedBrands } = body;

        if (action === 'reorder' && Array.isArray(orderedBrands)) {
            // Update order_index for each brand
            for (let i = 0; i < orderedBrands.length; i++) {
                const brandName = orderedBrands[i];
                await supabase
                    .from('brands')
                    .update({ order_index: i })
                    .eq('name', brandName);
            }
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// DELETE: Remove brand
export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const name = searchParams.get('name');

        if (!name) {
            return NextResponse.json({ error: "Name required" }, { status: 400 });
        }

        // Also delete associated inventory
        await supabase.from('inventory').delete().eq('brand', name);
        const { error } = await supabase.from('brands').delete().eq('name', name);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
