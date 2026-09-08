import { TableBillScreen } from "@/features/billing/components/table-bill-screen";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";
import { notFound, redirect } from "next/navigation";

export default async function BillPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  if (!isValidTableId(tableId)) redirect(`/table/${encodeURIComponent(tableId)}`);
  if (!Number(tableId)) notFound();
  return <TableBillScreen tableId={Number(tableId)} />;
}
