import { redirect } from "next/navigation";
import { CartScreen } from "@/features/cart/components/cart-screen";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";

type TableCartPageProps = {
  params: Promise<{ tableId: string }>;
};

export default async function TableCartPage({ params }: TableCartPageProps) {
  const { tableId } = await params;

  if (!isValidTableId(tableId)) {
    redirect(`/table/${encodeURIComponent(tableId)}`);
  }

  return <CartScreen tableId={Number(tableId)} />;
}
