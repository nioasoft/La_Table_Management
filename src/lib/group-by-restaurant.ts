export const NO_RESTAURANT = "ללא מסעדה";

export interface RestaurantGroup<T> {
  key: string;
  name: string;
  rows: T[];
}

/**
 * Groups rows under each restaurant they belong to, restaurants sorted by
 * Hebrew name. A row linked to two restaurants shows under both; a row with
 * none lands in a trailing "ללא מסעדה" group.
 */
export function groupByRestaurant<
  T extends { franchisees: Array<{ id: string; name: string }> },
>(rows: T[]): RestaurantGroup<T>[] {
  const groups = new Map<string, RestaurantGroup<T>>();
  for (const row of rows) {
    const owners = row.franchisees.length
      ? row.franchisees
      : [{ id: "", name: NO_RESTAURANT }];
    for (const { id, name } of owners) {
      const group = groups.get(id) ?? { key: id, name, rows: [] };
      group.rows.push(row);
      groups.set(id, group);
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.key === "" ? 1 : b.key === "" ? -1 : a.name.localeCompare(b.name, "he")
  );
}
