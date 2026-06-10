import { describe, it, expect } from "vitest";
import { parseBatchStream } from "./batch-code";

describe("parseBatchStream", () => {
  it("recognizes every engineering token variant seen in prod", () => {
    expect(parseBatchStream("EnableStudents_12_25_Engg_C08")).toBe("engineering");
    expect(parseBatchStream("EnableStudents_11_Photon_Eng_24_N017")).toBe("engineering");
    expect(parseBatchStream("EnableStudents_TP_2027_engg_C027")).toBe("engineering");
    expect(parseBatchStream("EnableStudents_TP_2028_eng_C029")).toBe("engineering");
  });

  it("recognizes medical token variants regardless of case", () => {
    expect(parseBatchStream("EnableStudents_12_25_Med_C08")).toBe("medical");
    expect(parseBatchStream("EnableStudents_TP_2028_med_C028")).toBe("medical");
    expect(parseBatchStream("EnableStudents_12_Photon_med_24_E001")).toBe("medical");
  });

  it("returns empty string when no stream token is present", () => {
    expect(parseBatchStream("EnableStudents_12_25_Clat")).toBe("");
    expect(parseBatchStream("EnableStudents_12_25_R08")).toBe("");
    expect(parseBatchStream("EnableStudents-TP-2027-common-Z001")).toBe("");
  });
});
