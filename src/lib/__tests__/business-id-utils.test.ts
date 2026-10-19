import { describe, it, expect } from "vitest";
import { isValidIsraeliBusinessId } from "../business-id-utils";

describe("isValidIsraeliBusinessId", () => {
  it("accepts a real ח.פ with a correct check digit", () => {
    expect(isValidIsraeliBusinessId("516148947")).toBe(true);
  });

  it("rejects a 9-digit number with a wrong check digit", () => {
    expect(isValidIsraeliBusinessId("515289702")).toBe(false);
  });

  it("rejects a short supplier customer code", () => {
    expect(isValidIsraeliBusinessId("00629")).toBe(false);
    expect(isValidIsraeliBusinessId("629")).toBe(false);
  });

  it("left-pads 8-digit IDs before checking", () => {
    expect(isValidIsraeliBusinessId("12345674")).toBe(true);
    expect(isValidIsraeliBusinessId("012345674")).toBe(true);
    expect(isValidIsraeliBusinessId("12345675")).toBe(false);
  });

  it("rejects empty and over-long input", () => {
    expect(isValidIsraeliBusinessId(null)).toBe(false);
    expect(isValidIsraeliBusinessId("")).toBe(false);
    expect(isValidIsraeliBusinessId("5161489470")).toBe(false);
  });
});
