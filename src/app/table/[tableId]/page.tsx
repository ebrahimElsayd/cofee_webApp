import { TableJoinScreen } from "@/features/table-session/components/table-join-screen";

type TableEntryPageProps = {
  params: Promise<{ tableId: string }>;
};

export default async function TableEntryPage({ params }: TableEntryPageProps) {
  const { tableId } = await params;

  return <TableJoinScreen rawTableId={tableId} />;
}
