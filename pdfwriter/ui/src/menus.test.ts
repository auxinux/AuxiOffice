import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("navigator", { platform: "Win32" });
vi.mock("@tauri-apps/api/menu", () => ({}));
vi.mock("@tauri-apps/api/window", () => ({}));

const { BROWSER_KEYS, IS_WINDOWS, keyName, shortcuts } = await import("./menus");
const key = (k: string, m: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });

describe("raccourcis sous Windows", () => {
  it("reconnaît la plateforme", () => expect(IS_WINDOWS).toBe(true));
  it("nomme les touches comme les raccourcis du menu", () => {
    const t = shortcuts();
    expect(t.get(keyName(key("s", { ctrlKey: true })))).toBe("save");
    expect(t.get(keyName(key("S", { ctrlKey: true, shiftKey: true })))).toBe("saveAs");
    expect(t.get(keyName(key("M", { ctrlKey: true, shiftKey: true })))).toBe("merge");
    expect(t.get(keyName(key("F4")))).toBe("sidebar");
    expect(t.get(keyName(key("=", { ctrlKey: true })))).toBe("zoomIn");
    expect(t.get(keyName(key("+", { ctrlKey: true })))).toBe("zoomIn");
    expect(t.get(keyName(key("-", { ctrlKey: true })))).toBe("zoomOut");
    expect(t.get(keyName(key("y", { ctrlKey: true })))).toBe("redo");
    expect(t.has(keyName(key("a")))).toBe(false);
  });
  it("bloque ce qui ferait perdre le document", () => {
    expect(BROWSER_KEYS.has(keyName(key("F5")))).toBe(true);
    expect(BROWSER_KEYS.has(keyName(key("r", { ctrlKey: true })))).toBe(true);
    expect(BROWSER_KEYS.has(keyName(key("ArrowLeft", { altKey: true })))).toBe(true);
    expect(BROWSER_KEYS.has(keyName(key("c", { ctrlKey: true })))).toBe(false);
  });
});
