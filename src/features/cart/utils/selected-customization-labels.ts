import type { SelectedCustomization } from "@/features/cart/types/draft-cart";

/** Uses staff-entered labels and falls back to the other language; never auto-translates. */
export function selectedCustomizationLabel(option: SelectedCustomization, locale: "ar" | "en" = "ar") {
  const group = locale === "ar" ? option.groupLabelAr || option.groupLabel : option.groupLabel || option.groupLabelAr;
  const value = locale === "ar" ? option.optionLabelAr || option.optionLabel : option.optionLabel || option.optionLabelAr;
  if (!value) return "";
  return group ? `${group}: ${value}` : value;
}
