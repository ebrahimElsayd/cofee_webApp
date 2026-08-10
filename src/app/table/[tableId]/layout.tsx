import { TableBottomNavigation } from "@/features/table-navigation/components/table-bottom-navigation";

export default async function TableLayout({
  children,
  params,
}: LayoutProps<"/table/[tableId]">) {
  const { tableId } = await params;
  const numericTableId = Number(tableId);

  return (
    <>
      {children}
      {Number.isInteger(numericTableId) && numericTableId > 0 && (
        <TableBottomNavigation tableId={numericTableId} />
      )}
    </>
  );
}
