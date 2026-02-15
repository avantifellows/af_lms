import { describe, it, expect } from "vitest";
import { validateGpsReading } from "./geo-validation";

describe("validateGpsReading", () => {
  describe("with start prefix", () => {
    it("accepts a valid reading", () => {
      const result = validateGpsReading(
        { start_lat: 28.6139, start_lng: 77.209, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(true);
      expect(result.reading).toEqual({ lat: 28.6139, lng: 77.209, accuracy: 10 });
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it("rejects missing lat", () => {
      const result = validateGpsReading(
        { start_lng: 77.209, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("start_lat");
    });

    it("rejects non-numeric values", () => {
      const result = validateGpsReading(
        { start_lat: "abc", start_lng: 77.209, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("must be numbers");
    });
  });

  describe("with end prefix", () => {
    it("accepts a valid reading", () => {
      const result = validateGpsReading(
        { end_lat: 28.6139, end_lng: 77.209, end_accuracy: 50 },
        "end"
      );
      expect(result.valid).toBe(true);
      expect(result.reading).toEqual({ lat: 28.6139, lng: 77.209, accuracy: 50 });
    });
  });

  describe("latitude validation", () => {
    it("rejects lat < -90", () => {
      const result = validateGpsReading(
        { start_lat: -91, start_lng: 0, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("between -90 and 90");
    });

    it("rejects lat > 90", () => {
      const result = validateGpsReading(
        { start_lat: 91, start_lng: 0, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(false);
    });

    it("accepts boundary values -90 and 90", () => {
      expect(
        validateGpsReading({ start_lat: -90, start_lng: 0, start_accuracy: 10 }, "start").valid
      ).toBe(true);
      expect(
        validateGpsReading({ start_lat: 90, start_lng: 0, start_accuracy: 10 }, "start").valid
      ).toBe(true);
    });
  });

  describe("longitude validation", () => {
    it("rejects lng < -180", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: -181, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("between -180 and 180");
    });

    it("rejects lng > 180", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: 181, start_accuracy: 10 },
        "start"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("accuracy validation", () => {
    it("rejects negative accuracy", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: 0, start_accuracy: -1 },
        "start"
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("positive number");
    });

    it("warns for accuracy between 100-500m", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: 0, start_accuracy: 250 },
        "start"
      );
      expect(result.valid).toBe(true);
      expect(result.warning).toContain("moderate");
      expect(result.warning).toContain("250m");
    });

    it("does not warn for accuracy <= 100m", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: 0, start_accuracy: 100 },
        "start"
      );
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it("rejects accuracy > 500m", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: 0, start_accuracy: 501 },
        "start"
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("GPS accuracy too low");
    });

    it("accepts accuracy at exactly 500m", () => {
      const result = validateGpsReading(
        { start_lat: 0, start_lng: 0, start_accuracy: 500 },
        "start"
      );
      expect(result.valid).toBe(true);
      expect(result.warning).toContain("moderate");
    });
  });
});
