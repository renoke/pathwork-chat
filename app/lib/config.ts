import fs from "fs";
import path from "path";

function loadModelEnv(): Record<string, string> {
  try {
    const modelEnvPath = path.join(process.cwd(), "model.env");
    if (!fs.existsSync(modelEnvPath)) {
      return {};
    }

    const content = fs.readFileSync(modelEnvPath, "utf-8");
    const config: Record<string, string> = {};

    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key) {
          config[key.trim()] = valueParts.join("=").trim();
        }
      }
    });

    return config;
  } catch (error) {
    console.error("Failed to load model.env:", error);
    return {};
  }
}

const modelConfig = loadModelEnv();

export function getConfig(key: string, defaultValue: string): string {
  return process.env[key] || modelConfig[key] || defaultValue;
}

export function getConfigNumber(key: string, defaultValue: number): number {
  const value = getConfig(key, String(defaultValue));
  return parseFloat(value) || defaultValue;
}

export function getConfigInt(key: string, defaultValue: number): number {
  const value = getConfig(key, String(defaultValue));
  return parseInt(value, 10) || defaultValue;
}
