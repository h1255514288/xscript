import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { App as AntApp } from "antd";
import { createQueryClient } from "../src/queryClient";
import { PackForm } from "../src/pages/pack/PackForm";

let submitted: Record<string, unknown> | undefined;
let scriptResponse: Promise<Response> | undefined;
const scripts = { items: [
  { id: 1, name: "签到助手", project_name: "checkin" },
  { id: 2, name: "巡检助手", project_name: "monitor" },
] };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  submitted = undefined;
  scriptResponse = undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/scripts") return scriptResponse ?? json(scripts);
    if (url === "/api/pack/jobs" && init?.body instanceof FormData) {
      submitted = JSON.parse(String(init.body.get("options")));
      return json({ id: 1 });
    }
    return json({ items: [] });
  }));
});

function renderForm(preset?: { script_id?: number; version_id?: number }) {
  return render(<AntApp><QueryClientProvider client={createQueryClient()}><MemoryRouter>
    <PackForm info={{ available: true, reason: "", release_signing: false, public_url: "" }}
      onCreated={() => {}} preset={preset} />
  </MemoryRouter></QueryClientProvider></AntApp>);
}
const nameInput = () => screen.getByLabelText("App 名称") as HTMLInputElement;
async function upload(name: string) {
  const file = new File(["test project"], name, { type: "application/zip" });
  await waitFor(() => expect(document.querySelector('input[type="file"][accept=".zip"]')).toBeTruthy());
  fireEvent.change(document.querySelector('input[type="file"][accept=".zip"]')!, { target: { files: [file] } });
  await screen.findByTitle(name);
}
async function selectScript(label: string) {
  fireEvent.mouseDown(await screen.findByLabelText("小程序"));
  fireEvent.click(await screen.findByText(label, { selector: ".ant-select-item-option-content" }));
}

describe("APK display name suggestions", () => {
  it("tracks a replacement zip and submits its name", async () => {
    renderForm();
    await upload("签到.zip");
    await waitFor(() => expect(nameInput().value).toBe("签到"));
    await upload("巡检.ZIP");
    await waitFor(() => expect(nameInput().value).toBe("巡检"));
    fireEvent.change(screen.getByLabelText("包名"), { target: { value: "com.example.demo" } });
    fireEvent.click(screen.getByRole("button", { name: /开始打包/ }));
    await waitFor(() => expect(submitted?.app_name).toBe("巡检"));
  });

  it("preserves a manually entered name when switching scripts and source", async () => {
    renderForm({ script_id: 1 });
    await waitFor(() => expect(nameInput().value).toBe("签到助手"));
    fireEvent.change(nameInput(), { target: { value: "我的专用工具" } });
    await selectScript("巡检助手（monitor）");
    expect(nameInput().value).toBe("我的专用工具");
    fireEvent.click(screen.getByRole("radio", { name: "上传 zip" }));
    await upload("新工程.zip");
    expect(nameInput().value).toBe("我的专用工具");
    fireEvent.change(nameInput(), { target: { value: "" } });
    await upload("另一个工程.zip");
    await waitFor(() => expect(nameInput().value).toBe("另一个工程"));
  });

  it("follows the active source until the name is edited", async () => {
    renderForm();
    await upload("本地工程.zip");
    fireEvent.click(screen.getByRole("radio", { name: "小程序版本" }));
    await selectScript("签到助手（checkin）");
    await waitFor(() => expect(nameInput().value).toBe("签到助手"));
    await selectScript("巡检助手（monitor）");
    await waitFor(() => expect(nameInput().value).toBe("巡检助手"));
    fireEvent.click(screen.getByRole("radio", { name: "上传 zip" }));
    await waitFor(() => expect(nameInput().value).toBe("本地工程"));
  });

  it("keeps edits made while a preset's script metadata is loading", async () => {
    let resolve!: (response: Response) => void;
    scriptResponse = new Promise(r => { resolve = r; });
    renderForm({ script_id: 1, version_id: 7 });
    fireEvent.change(nameInput(), { target: { value: "加载前手动填写" } });
    resolve(json(scripts));
    await screen.findByText("签到助手（checkin）");
    expect(nameInput().value).toBe("加载前手动填写");
  });
});
