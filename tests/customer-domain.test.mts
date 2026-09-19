import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCustomizationsPrice,
  createDefaultSelections,
  findMissingRequiredGroup,
  getSelectedCustomizations,
} from "../src/features/menu/utils/customization.ts";
import { generateSafeUUID } from "../src/shared/utils/uuid.ts";
import type { CustomizationGroup } from "../src/features/menu/types/menu.ts";

const groups: CustomizationGroup[] = [
  {
    id: "size",
    label: "Size",
    labelAr: "الحجم",
    type: "single",
    display: "segmented",
    required: true,
    options: [
      { id: "small", label: "Small", labelAr: "صغير", price: 0, available: false },
      { id: "medium", label: "Medium", labelAr: "متوسط", price: 10, available: true },
    ],
  },
  {
    id: "milk",
    label: "Milk",
    labelAr: "الحليب",
    type: "single",
    display: "cards",
    required: false,
    options: [
      { id: "oat", label: "Oat", labelAr: "شوفان", price: 15, available: true },
    ],
  },
];

test("required customization defaults to the first available option", () => {
  assert.deepEqual(createDefaultSelections(groups), { size: "medium" });
});

test("selected customizations preserve bilingual labels and calculate price", () => {
  const selections = { size: "medium", milk: "oat" };
  assert.deepEqual(getSelectedCustomizations(groups, selections), [
    { groupId: "size", groupLabel: "Size", groupLabelAr: "الحجم", optionId: "medium", optionLabel: "Medium", optionLabelAr: "متوسط", price: 10 },
    { groupId: "milk", groupLabel: "Milk", groupLabelAr: "الحليب", optionId: "oat", optionLabel: "Oat", optionLabelAr: "شوفان", price: 15 },
  ]);
  assert.equal(calculateCustomizationsPrice(groups, selections), 25);
});

test("unavailable selection cannot satisfy a required group or affect price", () => {
  const selections = { size: "small" };
  assert.equal(findMissingRequiredGroup(groups, selections)?.id, "size");
  assert.equal(calculateCustomizationsPrice(groups, selections), 0);
});

test("safe UUID is RFC 4122 version 4 shaped and unique", () => {
  const values = Array.from({ length: 100 }, () => generateSafeUUID());
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(values.every((value) => uuidV4.test(value)));
  assert.equal(new Set(values).size, values.length);
});
