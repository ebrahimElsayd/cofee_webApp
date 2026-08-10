export type SelectedCustomization = {
  groupId: string;
  groupLabel: string;
  groupLabelAr: string;
  optionId: string;
  optionLabel: string;
  optionLabelAr: string;
  price: number;
};

export type DraftCartItem = {
  id: string;
  tableId: number;
  productId: string;
  productSlug: string;
  productName: string;
  productNameAr: string;
  productImageUrl: string;
  recipientName: string;
  selectedOptions: SelectedCustomization[];
  notes: string;
  quantity: number;
  basePrice: number;
  customizationsPrice: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: string;
  status?: "received" | "preparing" | "ready" | "served" | "cancelled";
};

export type NewDraftCartItem = Omit<DraftCartItem, "id" | "createdAt">;

export type SubmittedTableOrder = {
  id: string;
  tableId: number;
  submittedBy: string;
  guestCount: number;
  itemCount: number;
  total: number;
  items: DraftCartItem[];
  status: "sent";
  submittedAt: string;
};
