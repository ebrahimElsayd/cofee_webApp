import { TableJoinScreen } from "@/features/table-session/components/table-join-screen";

type TableEntryPageProps = {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ cafe?: string; token?: string }>;
};

export default async function TableEntryPage({ params, searchParams }: TableEntryPageProps) {
  const { tableId } = await params;
  const { cafe, token } = await searchParams;

  return <TableJoinScreen rawTableId={tableId} cafeId={cafe} tableToken={token} />;
}
