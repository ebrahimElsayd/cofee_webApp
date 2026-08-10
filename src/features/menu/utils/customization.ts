import type { SelectedCustomization } from "@/features/cart/types/draft-cart";
import type { CustomizationGroup } from "../types/menu";

export type ProductSelections = Record<string, string>;

export function createDefaultSelections(groups: CustomizationGroup[]): ProductSelections {
  return Object.fromEntries(
    groups.flatMap((group) => {
      if (!group.required) return [];

      const firstAvailableOption = group.options.find((option) => option.available);
      return firstAvailableOption ? [[group.id, firstAvailableOption.id]] : [];
    }),
  );
}

export function getSelectedCustomizations(
  groups: CustomizationGroup[],
  selections: ProductSelections,
): SelectedCustomization[] {
  return groups.flatMap((group) => {
    const selectedOption = group.options.find(
      (option) => option.id === selections[group.id] && option.available,
    );

    if (!selectedOption) return [];

    return [{
      groupId: group.id,
      groupLabel: group.label,
      groupLabelAr: group.labelAr,
      optionId: selectedOption.id,
      optionLabel: selectedOption.label,
      optionLabelAr: selectedOption.labelAr,
      price: selectedOption.price,
    }];
  });
}

export function findMissingRequiredGroup(
  groups: CustomizationGroup[],
  selections: ProductSelections,
): CustomizationGroup | undefined {
  return groups.find((group) => {
    if (!group.required) return false;

    return !group.options.some(
      (option) => option.id === selections[group.id] && option.available,
    );
  });
}

export function calculateCustomizationsPrice(
  groups: CustomizationGroup[],
  selections: ProductSelections,
) {
  return getSelectedCustomizations(groups, selections).reduce(
    (total, option) => total + option.price,
    0,
  );
}
