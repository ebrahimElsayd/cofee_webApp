import { redirect } from "next/navigation";
import { MenuScreen } from "@/features/menu/components/menu-screen";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";

type TableMenuPageProps = {
  params: Promise<{ tableId: string }>;
};

export default async function TableMenuPage({ params }: TableMenuPageProps) {
  const { tableId } = await params;

  if (!isValidTableId(tableId)) {
    redirect(`/table/${encodeURIComponent(tableId)}`);
  }

  return <MenuScreen tableId={Number(tableId)} />;
}
