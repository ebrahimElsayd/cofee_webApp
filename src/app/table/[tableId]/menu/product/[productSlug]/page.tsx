import { redirect } from "next/navigation";
import { ProductDetailsRoute } from "@/features/menu/components/product-details-route";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";

type ProductDetailsPageProps = {
  params: Promise<{ tableId: string; productSlug: string }>;
};

export default async function ProductDetailsPage({ params }: ProductDetailsPageProps) {
  const { tableId, productSlug } = await params;

  if (!isValidTableId(tableId)) {
    redirect(`/table/${encodeURIComponent(tableId)}`);
  }

  return <ProductDetailsRoute productSlug={productSlug} tableId={Number(tableId)} />;
}
