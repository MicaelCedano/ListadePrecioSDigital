
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET: Fetch all brands
export async function GET() {
    try {
        const stmt = db.prepare('SELECT name, color, order_index FROM brands ORDER BY order_index');
        const brands = stmt.all();
        return NextResponse.json(brands);
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// POST: Add new brand
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, color, order_index } = body;
        const stmt = db.prepare('INSERT OR REPLACE INTO brands (name, color, order_index) VALUES (?, ?, ?)');
        stmt.run(name, color, order_index);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// PUT: Reorder or update brands
export async function PUT(req: Request) {
    try {
        const body = await req.json();
        const { brands } = body; // Expects an array of brands with new order

        // Start transaction
        const update = db.transaction((items) => {
            for (const item of items) {
                // If we don't have order_index in item, try to use index in array
                const orderIndex = item.order_index !== undefined ? item.order_index : items.indexOf(item);
                db.prepare('UPDATE brands SET order_index = ?, color = ? WHERE name = ?').run(orderIndex, item.color, item.name);
            }
        });

        update(brands);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// DELETE: Remove brand
export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const name = searchParams.get('name');
        const stmt = db.prepare('DELETE FROM brands WHERE name = ?');
        stmt.run(name);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
