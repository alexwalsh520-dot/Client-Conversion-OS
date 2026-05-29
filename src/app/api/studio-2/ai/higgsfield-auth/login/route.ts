import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { getHiggsfieldCommand, saveHiggsfieldCredentials } from "@/lib/higgsfield-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StreamPayload = Record<string, unknown>;

function encodeEvent(event: string, payload: StreamPayload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function redactAuthText(value: string) {
  return value
    .replace(/https:\/\/higgsfield\.ai\/device\?code=[^\s]+/gi, "https://higgsfield.ai/device?code=[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .trim();
}

function cleanLoginError(stdout: string, stderr: string) {
  const text = redactAuthText([stderr, stdout].filter(Boolean).join("\n"));
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("Waiting for approval"))
    .slice(-4);
  return lines.join(" ") || "Higgsfield login did not finish.";
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let child: ReturnType<typeof spawn> | null = null;
  let timeout: NodeJS.Timeout | null = null;
  let tempDir = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finished = false;
      const send = (event: string, payload: StreamPayload) => {
        if (finished) return;
        controller.enqueue(encoder.encode(encodeEvent(event, payload)));
      };
      const cleanup = async () => {
        if (timeout) clearTimeout(timeout);
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      };
      const fail = async (message: string) => {
        if (finished) return;
        send("error", { message });
        finished = true;
        await cleanup();
        controller.close();
      };

      try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccos-higgsfield-login-"));
        const credentialsPath = path.join(tempDir, "credentials.json");
        const command = getHiggsfieldCommand();

        const loginProcess = spawn(command.file, [...command.args, "auth", "login", "--no-color"], {
          env: {
            ...process.env,
            BROWSER: "/bin/false",
            HIGGSFIELD_CREDENTIALS_PATH: credentialsPath,
            HIGGSFIELD_DISABLE_TELEMETRY: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child = loginProcess;

        let stdout = "";
        let stderr = "";
        let loginUrlSent = false;
        const parseLoginUrl = (chunk: string) => {
          const match = chunk.match(/https:\/\/higgsfield\.ai\/device\?code=[^\s]+/i);
          if (!match || loginUrlSent) return;
          loginUrlSent = true;
          send("login_url", {
            url: match[0],
            message: "Approve Higgsfield in the tab that opened. Studio will finish the reconnect automatically.",
          });
        };

        send("status", { message: "Starting Higgsfield login..." });

        loginProcess.stdout.on("data", (data) => {
          const text = String(data);
          stdout += text;
          parseLoginUrl(text);
          if (/Waiting for approval/i.test(text)) {
            send("status", { message: "Waiting for Higgsfield approval..." });
          }
        });

        loginProcess.stderr.on("data", (data) => {
          const text = String(data);
          stderr += text;
          parseLoginUrl(text);
        });

        loginProcess.on("error", async (err) => {
          await fail(err instanceof Error ? err.message : "Could not start Higgsfield login.");
        });

        loginProcess.on("close", async (code) => {
          if (code !== 0) {
            await fail(cleanLoginError(stdout, stderr));
            return;
          }

          try {
            const credentialsJson = await fs.readFile(credentialsPath, "utf8");
            await saveHiggsfieldCredentials(JSON.parse(credentialsJson));
            if (finished) return;
            send("connected", { message: "Higgsfield is connected." });
            finished = true;
            await cleanup();
            controller.close();
          } catch (err) {
            await fail(err instanceof Error ? err.message : "Higgsfield logged in, but Studio could not save the new token.");
          }
        });

        timeout = setTimeout(() => {
          child?.kill("SIGTERM");
          void fail("Higgsfield login timed out. Open reconnect and try again.");
        }, 240_000);

        req.signal.addEventListener("abort", () => {
          child?.kill("SIGTERM");
          void cleanup();
        });
      } catch (err) {
        await fail(err instanceof Error ? err.message : "Could not start Higgsfield login.");
      }
    },
    cancel() {
      child?.kill("SIGTERM");
      if (timeout) clearTimeout(timeout);
      if (tempDir) void fs.rm(tempDir, { recursive: true, force: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
    },
  });
}
