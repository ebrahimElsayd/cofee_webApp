import { notFound, redirect } from "next/navigation";
import { ProductDetailsScreen } from "@/features/menu/components/product-details-screen";
import { menuProducts } from "@/features/menu/data/menu.data";
import { isValidTableId } from "@/features/table-session/services/local-table-session.service";

type ProductDetailsPageProps = {
  params: Promise<{ tableId: string; productSlug: string }>;
};

export default async function ProductDetailsPage({ params }: ProductDetailsPageProps) {
  const { tableId, productSlug } = await params;

  if (!isValidTableId(tableId)) {
    redirect(`/table/${encodeURIComponent(tableId)}`);
  }

  const product = menuProducts.find((item) => item.slug === productSlug);

  if (!product || product.availability === "sold-out") {
    notFound();
  }

  return <ProductDetailsScreen product={product} tableId={Number(tableId)} />;
}
