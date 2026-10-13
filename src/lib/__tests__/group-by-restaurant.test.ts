import { describe, it, expect } from "vitest";
import { groupByRestaurant, NO_RESTAURANT } from "../group-by-restaurant";

const row = (id: string, ...restaurants: string[]) => ({
  id,
  franchisees: restaurants.map((name) => ({ id: name, name })),
});

describe("groupByRestaurant", () => {
  it("groups by restaurant, Hebrew order, unassigned last", () => {
    const groups = groupByRestaurant([
      row("a", "קינג קונג חורב"),
      row("b"),
      row("c", "ויני רגבה"),
      row("d", "קינג קונג חורב"),
    ]);
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
      ["ויני רגבה", ["c"]],
      ["קינג קונג חורב", ["a", "d"]],
      [NO_RESTAURANT, ["b"]],
    ]);
  });

  it("lists a client seen at two restaurants under both", () => {
    const groups = groupByRestaurant([row("a", "קסטרא טומאיי", "מיאמוטו")]);
    expect(groups.map((g) => g.name)).toEqual(["מיאמוטו", "קסטרא טומאיי"]);
  });
});
