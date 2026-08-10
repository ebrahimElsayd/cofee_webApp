import { NextResponse } from "next/server";
import type { DraftCartItem, NewDraftCartItem } from "@/features/cart/types/draft-cart";

const sharedCarts = new Map<number, DraftCartItem[]>();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tableId: string }> },
) {
  const tableId = Number((await params).tableId);
  return NextResponse.json(sharedCarts.get(tableId) ?? []);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tableId: string }> },
) {
  const tableId = Number((await params).tableId);
  const body = (await request.json()) as NewDraftCartItem;
  const item: DraftCartItem = {
    ...body,
    tableId,
    id: `shared-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };
  const cart = sharedCarts.get(tableId) ?? [];
  sharedCarts.set(tableId, [...cart, item]);
  return NextResponse.json(item, { status: 201 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tableId: string }> },
) {
  const tableId = Number((await params).tableId);
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId) sharedCarts.delete(tableId);
  else sharedCarts.set(tableId, (sharedCarts.get(tableId) ?? []).filter((item) => item.id !== itemId));
  return NextResponse.json({ ok: true });
}
