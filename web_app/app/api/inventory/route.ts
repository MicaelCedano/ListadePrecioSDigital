
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET: Fetch all inventory items
export async function GET() {
    try {
        const stmt = db.prepare('SELECT id, brand, model, specs, price_float, price_str FROM inventory');
        const items = stmt.all();
        return NextResponse.json(items);
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// POST: Add or Update inventory item
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { id, brand, model, specs, price_float, price_str } = body;
        const stmt = db.prepare('INSERT OR REPLACE INTO inventory (id, brand, model, specs, price_float, price_str) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(id, brand, model, specs, price_float, price_str);
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
        const stmt = db.prepare('DELETE FROM inventory WHERE id = ?');
        stmt.run(id);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
