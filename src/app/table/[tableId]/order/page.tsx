import { redirect } from "next/navigation";
import { AnimatedOrderTrackingScreen } from "@/features/table-navigation/components/animated-order-tracking-screen";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";

export default async function OrderPage({ params }: PageProps<"/table/[tableId]/order">) {
  const { tableId } = await params;
  if (!isValidTableId(tableId)) redirect(`/table/${encodeURIComponent(tableId)}`);
  return <AnimatedOrderTrackingScreen tableId={Number(tableId)} />;
}
