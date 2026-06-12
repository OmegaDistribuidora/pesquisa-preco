import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function readLocalCredentials() {
  const file = path.resolve(process.cwd(), "credenciais.txt");
  if (!fs.existsSync(file)) return {};

  const pairs: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (match) pairs[match[1].trim()] = match[2].trim();
  }
  return pairs;
}

const localCredentials = readLocalCredentials();

export const config = {
  port: Number(process.env.PORT || 3000),
  adminLogin: process.env.ADMIN_LOGIN || localCredentials.admin_login || "",
  adminPassword: process.env.ADMIN_PASSWORD || localCredentials.admin_password || "",
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads")
};
