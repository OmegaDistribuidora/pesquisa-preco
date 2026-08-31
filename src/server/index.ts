import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";

type QuestionKind = "short_text" | "long_text" | "options" | "dropdown" | "rating" | "upload";
type TextType = "text" | "integer" | "decimal" | "currency";

type QuestionInput = {
  id?: string;
  title: string;
  kind: QuestionKind;
  required: boolean;
  textType?: TextType;
  options?: string[];
  multiple?: boolean;
  hasFile?: boolean;
  fileMaxMb?: number | null;
};

const app = express();
const upload = multer({ dest: config.uploadDir, limits: { fileSize: 50 * 1024 * 1024, files: 30 } });
const publicFileCacheControl = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=604800";

fs.mkdirSync(config.uploadDir, { recursive: true });

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
app.get("/api/question-images/:file", async (req, res) => {
  const file = path.basename(req.params.file);
  const result = await pool.query("select 1 from questions where image_path=$1 limit 1", [file]);
  if (!result.rowCount) {
    res.status(404).json({ error: "Imagem não encontrada." });
    return;
  }
  res.sendFile(path.join(config.uploadDir, file), {
    cacheControl: false,
    headers: { "Cache-Control": publicFileCacheControl }
  });
});
app.get("/api/admin/files/:file", requireAdmin, async (req, res) => {
  const file = path.basename(String(req.params.file));
  const result = await pool.query(
    `select file_name, file_mime from answer_files where file_path=$1
     union all
     select file_name, file_mime from answers where file_path=$1
     limit 1`,
    [file]
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }
  const originalName = path.basename(String(result.rows[0].file_name || "arquivo"));
  res.type(result.rows[0].file_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${originalName}"`);
  res.sendFile(path.join(config.uploadDir, file), { cacheControl: false });
});
app.get("/api/files/:file", async (req, res) => {
  const file = path.basename(String(req.params.file));
  const result = await pool.query(
    `select file_name, file_mime from answer_files where file_path=$1
     union all
     select file_name, file_mime from answers where file_path=$1
     limit 1`,
    [file]
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }
  const originalName = path.basename(String(result.rows[0].file_name || "arquivo"));
  res.type(result.rows[0].file_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${originalName}"`);
  res.sendFile(path.join(config.uploadDir, file), {
    cacheControl: false,
    headers: { "Cache-Control": publicFileCacheControl }
  });
});
app.use(
  "/uploads",
  requireAdmin,
  (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  },
  express.static(config.uploadDir, { cacheControl: false })
);

const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const submitLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

function uuid() {
  return crypto.randomUUID();
}

async function removeUploadedFiles(filePaths: Array<string | null | undefined>) {
  await Promise.all(
    [...new Set(filePaths.filter(Boolean).map((filePath) => path.basename(String(filePath))))].map(async (file) => {
      try {
        await fs.promises.unlink(path.join(config.uploadDir, file));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          console.warn(`Nao foi possivel remover arquivo ${file}:`, error);
        }
      }
    })
  );
}

function signAdminToken() {
  return jwt.sign({ role: "admin" }, config.sessionSecret, { expiresIn: "8h" });
}

function isAdminToken(token?: string) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, config.sessionSecret);
    return typeof payload === "object" && payload.role === "admin";
  } catch {
    return false;
  }
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isAdminToken(req.cookies.admin_token)) {
    res.status(401).json({ error: "Acesso administrativo necessário." });
    return;
  }
  next();
}

function getRespondentKey(req: express.Request, res: express.Response) {
  let key = req.cookies.respondent_key;
  if (!key || typeof key !== "string" || key.length < 20) {
    key = crypto.randomBytes(24).toString("hex");
    res.cookie("respondent_key", key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }
  return key;
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeQuestion(input: QuestionInput, position: number) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Toda pergunta precisa de título.");
  const kind = input.kind;
  if (!["short_text", "long_text", "options", "dropdown", "rating", "upload"].includes(kind)) {
    throw new Error("Tipo de pergunta inválido.");
  }
  const options = Array.isArray(input.options) ? input.options.map((x) => String(x).trim()).filter(Boolean) : [];
  if ((kind === "options" || kind === "dropdown") && options.length < 2) {
    throw new Error("Perguntas de opção precisam de pelo menos duas alternativas.");
  }
  const hasFile = kind === "upload" || Boolean(input.hasFile);
  const fileMaxMb = hasFile ? Math.max(1, Math.min(50, Number(input.fileMaxMb || 5))) : null;
  return {
    id: input.id || uuid(),
    position,
    title,
    kind,
    required: Boolean(input.required),
    textType: kind === "short_text" || kind === "long_text" ? input.textType || "text" : null,
    options,
    multiple: kind === "options" ? Boolean(input.multiple) : false,
    hasFile,
    fileMaxMb
  };
}

function normalizeBrazilianDecimalText(value: string) {
  const cleaned = value.trim().replace(/[^\d,.-]/g, "");
  if (!cleaned.includes(",") && /^\d+\.\d{1,2}$/.test(cleaned)) return cleaned.replace(".", ",");
  return cleaned;
}

function brNumberToNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const text = normalizeBrazilianDecimalText(String(value).replace(/^R\$\s*/i, "").trim());
  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return number;
}

function validateTextValue(value: unknown, textType: TextType) {
  const rawText = String(value ?? "").trim();
  const hasCurrencyPrefix = /^R\$\s*/i.test(rawText);
  const text = textType === "currency" ? rawText.replace(/^R\$\s*/i, "").trim() : rawText;
  const normalizedText = textType === "decimal" || textType === "currency" ? normalizeBrazilianDecimalText(text) : text;
  if (!text) return { text: "", number: null };
  if (textType === "integer" && !/^\d+$/.test(text)) throw new Error("Informe apenas numeros inteiros.");
  if ((textType === "decimal" || textType === "currency") && !/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(normalizedText)) {
    throw new Error("Informe um numero no formato brasileiro.");
  }
  const displayText = textType === "currency" && hasCurrencyPrefix ? `R$ ${normalizedText}` : normalizedText;
  return {
    text: textType === "decimal" || textType === "currency" ? displayText : rawText,
    number: textType === "integer" || textType === "decimal" || textType === "currency" ? brNumberToNumber(normalizedText) : null
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (!/[;"\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeExportAnswer(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') || trimmed.startsWith("[") || trimmed.startsWith("{"))) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.join(", ");
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function cleanExportText(value: unknown) {
  const text = String(value ?? "").trim();
  return text === "[object Object]" ? "" : text;
}

function formatExportNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function publicFileUrl(req: express.Request, filePath: string) {
  const baseUrl = config.publicBaseUrl || `${req.protocol}://${req.get("host")}`;
  return `${baseUrl.replace(/\/$/, "")}/api/files/${encodeURIComponent(filePath)}`;
}

app.post("/api/admin/login", (req, res) => {
  const { login, password } = req.body || {};
  if (!config.adminLogin || !config.adminPassword) {
    res.status(500).json({ error: "Credenciais administrativas não configuradas." });
    return;
  }
  if (safeCompare(String(login || ""), config.adminLogin) && safeCompare(String(password || ""), config.adminPassword)) {
    res.cookie("admin_token", signAdminToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    });
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ error: "Login ou senha inválidos." });
});

app.post("/api/admin/logout", (_req, res) => {
  res.clearCookie("admin_token");
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ admin: isAdminToken(req.cookies.admin_token) });
});

app.get("/api/admin/surveys", requireAdmin, async (_req, res) => {
  const result = await pool.query(`
    select s.*, count(r.id)::int as response_count
    from surveys s
    left join responses r on r.survey_id = s.id
    group by s.id
    order by s.created_at desc
  `);
  res.json(result.rows);
});

app.post("/api/admin/surveys/:id/close", requireAdmin, async (req, res) => {
  const result = await pool.query("update surveys set closed_at = now() where id=$1 and closed_at is null returning *", [req.params.id]);
  if (!result.rowCount) {
    res.status(404).json({ error: "Pesquisa não encontrada ou já encerrada." });
    return;
  }
  res.json({ ok: true, survey: result.rows[0] });
});

app.delete("/api/admin/surveys/:id", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  let filePaths: Array<string | null> = [];
  try {
    await client.query("begin");
    const survey = await client.query("select id from surveys where id=$1", [req.params.id]);
    if (!survey.rowCount) throw new Error("Pesquisa nao encontrada.");
    const files = await client.query(
      `select image_path as file_path from questions where survey_id=$1 and image_path is not null
       union all
       select answers.file_path from answers
       join responses on responses.id = answers.response_id
       where responses.survey_id=$1 and answers.file_path is not null
       union all
       select answer_files.file_path from answer_files
       join answers on answers.id = answer_files.answer_id
       join responses on responses.id = answers.response_id
       where responses.survey_id=$1`,
      [req.params.id]
    );
    filePaths = files.rows.map((row) => row.file_path);
    await client.query("delete from surveys where id=$1", [req.params.id]);
    await client.query("commit");
    await removeUploadedFiles(filePaths);
    res.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    res.status(404).json({ error: error instanceof Error ? error.message : "Erro ao excluir pesquisa." });
  } finally {
    client.release();
  }
});

app.delete("/api/admin/responses/:id", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  let filePaths: Array<string | null> = [];
  try {
    await client.query("begin");
    const response = await client.query("select id from responses where id=$1", [req.params.id]);
    if (!response.rowCount) throw new Error("Resposta nao encontrada.");
    const files = await client.query(
      `select answers.file_path from answers
       where answers.response_id=$1 and answers.file_path is not null
       union all
       select answer_files.file_path from answer_files
       join answers on answers.id = answer_files.answer_id
       where answers.response_id=$1`,
      [req.params.id]
    );
    filePaths = files.rows.map((row) => row.file_path);
    await client.query("delete from submission_logs where response_id=$1", [req.params.id]);
    await client.query("delete from responses where id=$1", [req.params.id]);
    await client.query("commit");
    await removeUploadedFiles(filePaths);
    res.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    res.status(404).json({ error: error instanceof Error ? error.message : "Erro ao excluir resposta." });
  } finally {
    client.release();
  }
});

app.post("/api/admin/surveys", requireAdmin, upload.any(), async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body.payload ? JSON.parse(String(req.body.payload)) : req.body;
    const uploadedFiles = ((req.files || []) as Express.Multer.File[]).reduce<Record<string, Express.Multer.File>>((acc, file) => {
      acc[file.fieldname] = file;
      return acc;
    }, {});
    const title = String(body.title || "").trim();
    if (!title) throw new Error("Informe o título da pesquisa.");
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
      throw new Error("Informe datas válidas de início e fim.");
    }
    const questions = (body.questions || []).map((q: QuestionInput, index: number) => normalizeQuestion(q, index));
    if (!questions.length) throw new Error("Crie pelo menos uma pergunta.");

    const surveyId = uuid();
    await client.query("begin");
    await client.query(
      "insert into surveys (id, title, description, image_url, starts_at, ends_at) values ($1,$2,$3,$4,$5,$6)",
      [surveyId, title, String(body.description || ""), String(body.imageUrl || "").trim() || null, startsAt.toISOString(), endsAt.toISOString()]
    );
    for (const q of questions) {
      const image = uploadedFiles[`question_image_${q.id}`];
      await client.query(
        `insert into questions
        (id, survey_id, position, title, kind, required, text_type, options, multiple, has_file, file_max_mb, image_name, image_path, image_mime)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          q.id,
          surveyId,
          q.position,
          q.title,
          q.kind,
          q.required,
          q.textType,
          JSON.stringify(q.options),
          q.multiple,
          q.hasFile,
          q.fileMaxMb,
          image?.originalname || null,
          image ? path.basename(image.path) : null,
          image?.mimetype || null
        ]
      );
    }
    await client.query("commit");
    res.status(201).json({ id: surveyId });
  } catch (error) {
    await client.query("rollback");
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro ao criar pesquisa." });
  } finally {
    client.release();
  }
});

app.put("/api/admin/surveys/:id", requireAdmin, upload.any(), async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body.payload ? JSON.parse(String(req.body.payload)) : req.body;
    const uploadedFiles = ((req.files || []) as Express.Multer.File[]).reduce<Record<string, Express.Multer.File>>((acc, file) => {
      acc[file.fieldname] = file;
      return acc;
    }, {});
    const title = String(body.title || "").trim();
    if (!title) throw new Error("Informe o título da pesquisa.");
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
      throw new Error("Informe datas válidas de início e fim.");
    }
    const questions = (body.questions || []).map((q: QuestionInput, index: number) => normalizeQuestion(q, index));
    if (!questions.length) throw new Error("Crie pelo menos uma pergunta.");

    await client.query("begin");
    const survey = await client.query(
      "update surveys set title=$1, description=$2, image_url=$3, starts_at=$4, ends_at=$5 where id=$6 returning id",
      [title, String(body.description || ""), String(body.imageUrl || "").trim() || null, startsAt.toISOString(), endsAt.toISOString(), req.params.id]
    );
    if (!survey.rowCount) throw new Error("Pesquisa não encontrada.");

    const keepIds = questions.map((q: ReturnType<typeof normalizeQuestion>) => q.id);
    await client.query("delete from questions where survey_id=$1 and not (id = any($2::uuid[]))", [req.params.id, keepIds]);

    for (const q of questions) {
      const image = uploadedFiles[`question_image_${q.id}`];
      await client.query(
        `insert into questions
        (id, survey_id, position, title, kind, required, text_type, options, multiple, has_file, file_max_mb, image_name, image_path, image_mime)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        on conflict (id) do update set
          position=excluded.position,
          title=excluded.title,
          kind=excluded.kind,
          required=excluded.required,
          text_type=excluded.text_type,
          options=excluded.options,
          multiple=excluded.multiple,
          has_file=excluded.has_file,
          file_max_mb=excluded.file_max_mb,
          image_name=coalesce(excluded.image_name, questions.image_name),
          image_path=coalesce(excluded.image_path, questions.image_path),
          image_mime=coalesce(excluded.image_mime, questions.image_mime)`,
        [
          q.id,
          req.params.id,
          q.position,
          q.title,
          q.kind,
          q.required,
          q.textType,
          JSON.stringify(q.options),
          q.multiple,
          q.hasFile,
          q.fileMaxMb,
          image?.originalname || null,
          image ? path.basename(image.path) : null,
          image?.mimetype || null
        ]
      );
    }
    await client.query("commit");
    res.json({ id: req.params.id });
  } catch (error) {
    await client.query("rollback");
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro ao editar pesquisa." });
  } finally {
    client.release();
  }
});

app.get("/api/admin/surveys/:id", requireAdmin, async (req, res) => {
  const survey = await pool.query("select * from surveys where id=$1", [req.params.id]);
  if (!survey.rowCount) return res.status(404).json({ error: "Pesquisa não encontrada." });
  const questions = await pool.query(
    `select *, case when image_path is not null then '/api/question-images/' || image_path else null end as image_url
    from questions where survey_id=$1 order by position`,
    [req.params.id]
  );
  const responses = await pool.query(
    `select r.id, r.submitted_at, jsonb_object_agg(q.id, jsonb_build_object(
      'title', q.title,
      'kind', q.kind,
      'noAnswer', a.no_answer,
      'noAnswerReason', a.no_answer_reason,
      'fileUnavailable', a.file_unavailable,
      'fileUnavailableReason', a.file_unavailable_reason,
      'valueText', a.value_text,
      'valueNumber', a.value_number,
      'valueJson', a.value_json,
      'fileName', a.file_name,
      'fileMime', a.file_mime,
      'fileSize', a.file_size,
      'fileUrl', case when a.file_path is not null and coalesce(jsonb_array_length(af.files), 0) = 0 then '/api/admin/files/' || a.file_path else null end,
      'files', coalesce(af.files, '[]'::jsonb)
    ) order by q.position) as answers
    from responses r
    join questions q on q.survey_id = r.survey_id
    left join answers a on a.response_id = r.id and a.question_id = q.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'fileName', answer_files.file_name,
        'fileMime', answer_files.file_mime,
        'fileSize', answer_files.file_size,
        'fileUrl', '/api/admin/files/' || answer_files.file_path
      ) order by answer_files.created_at) as files
      from answer_files
      where answer_files.answer_id = a.id
    ) af on true
    where r.survey_id=$1
    group by r.id
    order by r.submitted_at desc`,
    [req.params.id]
  );
  const submissionLogs = await pool.query(
    `select id, response_id, status, error_message, user_agent, created_at, updated_at
    from submission_logs
    where survey_id=$1
    order by created_at desc
    limit 20`,
    [req.params.id]
  );
  res.json({ survey: survey.rows[0], questions: questions.rows, responses: responses.rows, submissionLogs: submissionLogs.rows });
});

app.get("/api/admin/surveys/:id/export", requireAdmin, async (req, res) => {
  const data = await pool.query(
    `select s.title as survey_title, q.title as question_title, q.position, q.text_type, r.id as response_id, r.submitted_at,
      coalesce(a.value_text, a.value_number::text, a.value_json::text, '') as answer,
      a.value_number,
      coalesce(files.file_paths, case when a.file_path is not null then array[a.file_path] else array[]::text[] end) as file_paths,
      coalesce(a.no_answer, false) as no_answer,
      a.no_answer_reason,
      coalesce(a.file_unavailable, false) as file_unavailable,
      a.file_unavailable_reason
    from surveys s
    join questions q on q.survey_id = s.id
    left join responses r on r.survey_id = s.id
    left join answers a on a.response_id = r.id and a.question_id = q.id
    left join lateral (
      select array_agg(answer_files.file_path order by answer_files.created_at) as file_paths
      from answer_files
      where answer_files.answer_id = a.id
    ) files on true
    where s.id=$1
    order by r.submitted_at desc, q.position`,
    [req.params.id]
  );

  const byResponse = new Map<string, Record<string, unknown>>();
  for (const row of data.rows) {
    const id = row.response_id || "sem_respostas";
    const record = byResponse.get(id) || { "Data da resposta": row.submitted_at ? new Date(row.submitted_at).toLocaleString("pt-BR") : "" };
    const links = Array.isArray(row.file_paths) ? row.file_paths.filter(Boolean).map((filePath: string) => publicFileUrl(req, filePath)) : [];
    const answer = row.text_type === "currency" && row.value_number !== null ? formatExportNumber(row.value_number) : cleanExportText(normalizeExportAnswer(row.answer));
    const fileUnavailable = row.file_unavailable ? `Não consigo tirar a foto: ${row.file_unavailable_reason || ""}` : "";
    const parts = [answer, ...links, fileUnavailable].filter((part) => String(part || "").trim() !== "");
    record[row.question_title] = row.no_answer ? `Não tenho uma resposta: ${row.no_answer_reason || ""}` : parts.join(" | ");
    byResponse.set(id, record);
  }
  const rows = [...byResponse.values()];
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [
    headers.map(csvCell).join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";"))
  ].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="respostas-${req.params.id}.csv"`);
  res.send(`\ufeff${csv}`);
});

app.get("/api/surveys", publicLimiter, async (req, res) => {
  getRespondentKey(req, res);
  const result = await pool.query(
    `select id, title, description, image_url, starts_at, ends_at
    from surveys
    where starts_at <= now() and ends_at >= now() and closed_at is null
    order by ends_at asc`
  );
  res.json(result.rows);
});

app.get("/api/surveys/:id", publicLimiter, async (req, res) => {
  getRespondentKey(req, res);
  const survey = await pool.query(
    "select id, title, description, image_url, starts_at, ends_at from surveys where id=$1 and starts_at <= now() and ends_at >= now() and closed_at is null",
    [req.params.id]
  );
  if (!survey.rowCount) return res.status(404).json({ error: "Pesquisa encerrada ou indisponível." });
  const questions = await pool.query(
    `select id, title, kind, required, text_type, options, multiple, has_file, file_max_mb,
      case when image_path is not null then '/api/question-images/' || image_path else null end as image_url
    from questions where survey_id=$1 order by position`,
    [req.params.id]
  );
  res.json({ survey: survey.rows[0], questions: questions.rows });
});

app.post("/api/surveys/:id/responses", submitLimiter, upload.any(), async (req, res) => {
  const client = await pool.connect();
  let logId = "";
  const responseId = uuid();
  try {
    const respondentKey = getRespondentKey(req, res);
    const ipHash = crypto.createHash("sha256").update(String(req.ip || "")).digest("hex");
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 500);
    logId = uuid();
    await pool.query(
      `insert into submission_logs (id, survey_id, response_id, status, respondent_key, ip_hash, user_agent)
      values ($1,$2,$3,'started',$4,$5,$6)`,
      [logId, req.params.id, responseId, respondentKey, ipHash, userAgent]
    );
    const survey = await client.query("select id from surveys where id=$1 and starts_at <= now() and ends_at >= now() and closed_at is null", [req.params.id]);
    if (!survey.rowCount) throw new Error("Pesquisa encerrada ou indisponível.");
    const questions = await client.query("select * from questions where survey_id=$1 order by position", [req.params.id]);
    const answers = JSON.parse(String(req.body.answers || "{}"));
    const files = ((req.files || []) as Express.Multer.File[]).reduce<Record<string, Express.Multer.File[]>>((acc, file) => {
      acc[file.fieldname] = [...(acc[file.fieldname] || []), file];
      return acc;
    }, {});

    await client.query("begin");
    await client.query(
      "insert into responses (id, survey_id, respondent_key, ip_hash, user_agent) values ($1,$2,$3,$4,$5)",
      [
        responseId,
        req.params.id,
        respondentKey,
        ipHash,
        userAgent
      ]
    );

    for (const q of questions.rows) {
      const rawAnswer = answers[q.id];
      const isStructuredAnswer = rawAnswer && typeof rawAnswer === "object" && !Array.isArray(rawAnswer);
      const rawValue = isStructuredAnswer && "value" in rawAnswer ? rawAnswer.value : rawAnswer;
      const noAnswer = Boolean(isStructuredAnswer && rawAnswer.noAnswer);
      const noAnswerReason = noAnswer ? String(rawAnswer.reason || "").trim() : "";
      const fileUnavailable = !noAnswer && Boolean(isStructuredAnswer && rawAnswer.fileUnavailable);
      const fileUnavailableReason = fileUnavailable ? String(rawAnswer.fileUnavailableReason || "").trim() : "";
      const questionFiles = files[`file_${q.id}`] || [];
      const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "";
      if (noAnswer && !noAnswerReason) throw new Error(`Justifique por que não pode responder: ${q.title}`);
      const requiresFile = Boolean(q.required && (q.has_file || q.kind === "upload"));
      if (fileUnavailable && !fileUnavailableReason) throw new Error(`Justifique por que não consegue tirar a foto: ${q.title}`);
      if (q.required && !noAnswer && q.kind !== "upload" && !hasValue) throw new Error(`Responda: ${q.title}`);
      if (requiresFile && !noAnswer && !fileUnavailable && !questionFiles.length) throw new Error(`Envie uma foto ou justifique a falta da foto: ${q.title}`);
      for (const file of questionFiles) {
        if (q.file_max_mb && file.size > q.file_max_mb * 1024 * 1024) {
          throw new Error(`Arquivo maior que o limite em: ${q.title}`);
        }
      }

      let valueText: string | null = null;
      let valueNumber: number | null = null;
      let valueJson: unknown = null;
      if (noAnswer) {
        valueText = null;
        valueNumber = null;
        valueJson = null;
      } else if (q.kind === "short_text" || q.kind === "long_text") {
        const parsed = validateTextValue(rawValue, q.text_type || "text");
        valueText = parsed.text || null;
        valueNumber = parsed.number;
      } else if (q.kind === "rating") {
        const rating = Number(rawValue);
      if (hasValue && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error(`Nota inválida em: ${q.title}`);
        valueNumber = hasValue ? rating : null;
        valueText = hasValue ? String(rawValue) : null;
      } else if (q.kind === "options" || q.kind === "dropdown") {
        const allowed = new Set((q.options || []) as string[]);
        const values = Array.isArray(rawValue) ? rawValue : hasValue ? [rawValue] : [];
        for (const value of values) if (!allowed.has(String(value))) throw new Error(`Opção inválida em: ${q.title}`);
        valueJson = q.multiple ? values : values[0] || null;
        valueText = values.length ? values.join(", ") : null;
      }

      const answerId = uuid();
      await client.query(
        `insert into answers
        (id, response_id, question_id, no_answer, no_answer_reason, file_unavailable, file_unavailable_reason, value_text, value_number, value_json, file_name, file_path, file_mime, file_size)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          answerId,
          responseId,
          q.id,
          noAnswer,
          noAnswerReason || null,
          fileUnavailable,
          fileUnavailableReason || null,
          valueText,
          valueNumber,
          valueJson === null ? null : JSON.stringify(valueJson),
          questionFiles[0]?.originalname || null,
          questionFiles[0] ? path.basename(questionFiles[0].path) : null,
          questionFiles[0]?.mimetype || null,
          questionFiles[0]?.size || null
        ]
      );
      for (const file of questionFiles) {
        await client.query(
          `insert into answer_files (id, answer_id, file_name, file_path, file_mime, file_size)
          values ($1,$2,$3,$4,$5,$6)`,
          [uuid(), answerId, file.originalname, path.basename(file.path), file.mimetype, file.size]
        );
      }
    }
    await client.query("commit");
    if (logId) await pool.query("update submission_logs set status='success', updated_at=now() where id=$1", [logId]);
    res.status(201).json({ ok: true, responseId });
  } catch (error) {
    await client.query("rollback");
    if (logId) {
      await pool.query("update submission_logs set status='failed', error_message=$2, updated_at=now() where id=$1", [logId, error instanceof Error ? error.message : "Erro ao enviar resposta."]);
    }
    const code = error && typeof error === "object" && "code" in error && error.code === "23505" ? 409 : 400;
    res.status(code).json({ error: code === 409 ? "Esta pesquisa já foi respondida neste navegador." : error instanceof Error ? error.message : "Erro ao enviar resposta." });
  } finally {
    client.release();
  }
});

const clientDist = path.resolve(process.cwd(), "dist/client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

migrate()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Pesquisa de preço rodando em http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao iniciar aplicação:", error);
    process.exit(1);
  });
