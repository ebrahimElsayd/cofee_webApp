import { redirect } from "next/navigation";
import { TableServiceScreen } from "@/features/table-navigation/components/table-utility-screen";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";

export default async function ServicePage({ params }: PageProps<"/table/[tableId]/service">) {
  const { tableId } = await params;
  if (!isValidTableId(tableId)) redirect(`/table/${encodeURIComponent(tableId)}`);
  return <TableServiceScreen tableId={Number(tableId)} />;
}
