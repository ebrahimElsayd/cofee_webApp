function getStorageKey(tableId: number) {
  return `kings-cafe:table:${tableId}:recipient-names`;
}

export function getLocalRecipientNames(tableId: number): string[] {
  try {
    const value = window.localStorage.getItem(getStorageKey(tableId));
    if (!value) return [];

    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

export function addLocalRecipientName(tableId: number, value: string): string[] {
  const name = value.trim().replace(/\s+/g, " ");
  const currentNames = getLocalRecipientNames(tableId);
  const existingName = currentNames.find(
    (item) => item.toLocaleLowerCase("ar") === name.toLocaleLowerCase("ar"),
  );
  const nextNames = existingName ? currentNames : [...currentNames, name];

  window.localStorage.setItem(getStorageKey(tableId), JSON.stringify(nextNames));
  return nextNames;
}
