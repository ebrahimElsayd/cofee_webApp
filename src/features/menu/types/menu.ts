export type MenuCategoryId =
  | "all"
  | "espresso"
  | "cold"
  | "tea"
  | "soft-drinks"
  | "specialty"
  | "food";

export type ProductBadge = "NEW" | "BESTSELLER" | "SPECIALTY" | "VEGAN";

export type CustomizationDisplay = "segmented" | "cards" | "curve";

export type CustomizationOption = {
  id: string;
  label: string;
  labelAr: string;
  price: number;
  available: boolean;
};

export type CustomizationGroup = {
  id: string;
  label: string;
  labelAr: string;
  required: boolean;
  display: CustomizationDisplay;
  options: CustomizationOption[];
};

export type MenuProduct = {
  id: string;
  slug: string;
  name: string;
  nameAr: string;
  description: string;
  categoryId: Exclude<MenuCategoryId, "all">;
  price: number;
  imageUrl: string;
  imageAlt: string;
  badge?: ProductBadge;
  availability: "available" | "sold-out";
  allowsNotes: boolean;
  customizationGroups: CustomizationGroup[];
  searchTerms: string[];
};

export type MenuCategory = {
  id: MenuCategoryId;
  label: string;
  labelAr: string;
};
