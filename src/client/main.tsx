import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Survey = {
  id: string;
  title: string;
  description: string;
  image_url?: string | null;
  starts_at: string;
  ends_at: string;
  closed_at?: string | null;
  response_count?: number;
};

type QuestionKind = "short_text" | "long_text" | "options" | "dropdown" | "rating" | "upload";
type TextType = "text" | "integer" | "decimal" | "currency";

type Question = {
  id: string;
  title: string;
  kind: QuestionKind;
  required: boolean;
  text_type?: TextType;
  textType?: TextType;
  options: string[];
  multiple: boolean;
  has_file?: boolean;
  hasFile?: boolean;
  file_max_mb?: number;
  fileMaxMb?: number;
  image_url?: string | null;
};

type Detail = {
  survey: Survey;
  questions: Question[];
  responses?: Array<{ id: string; submitted_at: string; answers: Record<string, AdminAnswer> }>;
  submissionLogs?: SubmissionLog[];
};

type SubmissionLog = {
  id: string;
  response_id?: string | null;
  status: "started" | "success" | "failed";
  error_message?: string | null;
  user_agent?: string | null;
  created_at: string;
  updated_at: string;
};

type AdminAnswer = {
  title: string;
  kind: QuestionKind;
  noAnswer?: boolean;
  noAnswerReason?: string;
  fileUnavailable?: boolean;
  fileUnavailableReason?: string;
  valueText?: string;
  valueNumber?: string;
  valueJson?: string | string[];
  fileName?: string;
  fileSize?: number;
  fileMime?: string;
  fileUrl?: string;
  files?: Array<{ fileName: string; fileSize?: number; fileMime?: string; fileUrl?: string }>;
};

type PublicAnswer = {
  value?: unknown;
  noAnswer?: boolean;
  reason?: string;
  fileUnavailable?: boolean;
  fileUnavailableReason?: string;
};

const api = {
  async get<T>(url: string): Promise<T> {
    const response = await fetch(url);
    return parseResponse<T>(response);
  },
  async post<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body ?? {})
    });
    return parseResponse<T>(response);
  },
  async put<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "PUT",
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body ?? {})
    });
    return parseResponse<T>(response);
  },
  async delete<T>(url: string): Promise<T> {
    const response = await fetch(url, { method: "DELETE" });
    return parseResponse<T>(response);
  }
};

async function parseResponse<T>(response: Response): Promise<T> {
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof data === "object" && data?.error ? data.error : "Erro inesperado.");
  return data as T;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function isSurveyOpen(survey: Survey) {
  const now = Date.now();
  return !survey.closed_at && new Date(survey.starts_at).getTime() <= now && new Date(survey.ends_at).getTime() >= now;
}

function surveyStatus(survey: Survey) {
  if (isSurveyOpen(survey)) return "open";
  if (!survey.closed_at && new Date(survey.starts_at).getTime() > Date.now()) return "scheduled";
  return "closed";
}

function surveyStatusLabel(survey: Survey) {
  const status = surveyStatus(survey);
  if (status === "open") return "Aberta";
  if (status === "scheduled") return "Agendada";
  return "Encerrada";
}

function submissionStatusLabel(status: SubmissionLog["status"]) {
  if (status === "success") return "Sucesso";
  if (status === "failed") return "Falhou";
  return "Iniciada";
}

function inputDateTime(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function questionDefaults(): Question {
  return {
    id: crypto.randomUUID(),
    title: "",
    kind: "short_text",
    required: true,
    textType: "text",
    options: ["Opção 1", "Opção 2"],
    multiple: false,
    hasFile: false,
    fileMaxMb: 5
  };
}

function normalizeCurrency(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const number = Number(digits) / 100;
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeDecimalInput(value: string) {
  const normalized = value.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(",");
  if (!decimalParts.length) return integerPart;
  return `${integerPart},${decimalParts.join("")}`;
}

function hasAnswerValue(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== "";
}

function bytesFromMb(mb: number) {
  return mb * 1024 * 1024;
}

function isCompressibleImage(file: File) {
  return file.type.startsWith("image/") && file.type !== "image/svg+xml";
}

function replaceExtension(name: string, extension: string) {
  const cleanName = name.replace(/\.[^.]+$/, "");
  return `${cleanName || "foto"}.${extension}`;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível compactar a imagem."))), "image/jpeg", quality);
  });
}

async function compressImageToLimit(file: File, maxBytes: number) {
  if (file.size <= maxBytes) return file;
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Este navegador não conseguiu compactar a imagem.");

  let scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  let quality = 0.86;
  let best: Blob | null = null;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, quality);
    if (!best || blob.size < best.size) best = blob;
    if (blob.size <= maxBytes) {
      return new File([blob], replaceExtension(file.name, "jpg"), { type: "image/jpeg", lastModified: Date.now() });
    }
    if (quality > 0.46) {
      quality -= 0.12;
    } else {
      scale *= 0.78;
      quality = 0.82;
    }
  }

  if (best && best.size <= maxBytes) return new File([best], replaceExtension(file.name, "jpg"), { type: "image/jpeg", lastModified: Date.now() });
  throw new Error(`Não foi possível reduzir "${file.name}" até o limite definido.`);
}

async function prepareFilesForUpload(selected: File[], maxMb: number) {
  const maxBytes = bytesFromMb(maxMb);
  const prepared: File[] = [];
  for (const file of selected) {
    if (file.size <= maxBytes) {
      prepared.push(file);
    } else if (isCompressibleImage(file)) {
      prepared.push(await compressImageToLimit(file, maxBytes));
    } else {
      throw new Error(`"${file.name}" ultrapassa ${maxMb} MB e não pode ser compactado automaticamente.`);
    }
  }
  return prepared;
}

function App() {
  const [admin, setAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [publicSurveys, setPublicSurveys] = useState<Survey[]>([]);
  const [selectedPublic, setSelectedPublic] = useState<Detail | null>(null);
  const [adminSurveys, setAdminSurveys] = useState<Survey[]>([]);
  const [adminDetail, setAdminDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [builderSeed, setBuilderSeed] = useState<Detail | null>(null);
  const [editingSeed, setEditingSeed] = useState<Detail | null>(null);
  const [notice, setNotice] = useState("");

  async function refresh() {
    const me = await api.get<{ admin: boolean }>("/api/admin/me");
    setAdmin(me.admin);
    if (me.admin) {
      setAdminSurveys(await api.get<Survey[]>("/api/admin/surveys"));
    }
    setPublicSurveys(await api.get<Survey[]>("/api/surveys"));
  }

  useEffect(() => {
    refresh().catch((error) => setNotice(error.message));
  }, []);

  async function openPublic(survey: Survey) {
    setSelectedPublic(await api.get<Detail>(`/api/surveys/${survey.id}`));
    setNotice("");
  }

  async function openAdmin(survey: Survey) {
    setAdminDetail(await api.get<Detail>(`/api/admin/surveys/${survey.id}`));
    setCreating(false);
  }

  async function logout() {
    await api.post("/api/admin/logout");
    setAdmin(false);
    setAdminDetail(null);
    setAdminSurveys([]);
  }

  return (
    <main>
      {admin && !selectedPublic && (
        <header className="topbar">
          <div>
            <p className="eyebrow">Pesquisa de preço</p>
            <h1>Administração</h1>
          </div>
        <button className="adminIconButton" onClick={admin ? logout : () => setLoginOpen(true)} title={admin ? "Sair do admin" : "Login admin"} aria-label={admin ? "Sair do admin" : "Login admin"}>
          Sair
        </button>
        </header>
      )}

      {notice && <div className="notice">{notice}</div>}

      {admin ? (
        <AdminArea
          surveys={adminSurveys}
          detail={adminDetail}
          creating={creating}
          onCreate={() => {
            setBuilderSeed(null);
            setEditingSeed(null);
            setCreating(true);
            setAdminDetail(null);
          }}
          onOpen={openAdmin}
          onEdit={(detail) => {
            setEditingSeed(detail);
            setBuilderSeed(null);
            setCreating(true);
            setAdminDetail(null);
          }}
          onCopy={(detail) => {
            setBuilderSeed(detail);
            setEditingSeed(null);
            setCreating(true);
            setAdminDetail(null);
            setNotice("Modelo copiado. Revise as informações e salve como uma nova pesquisa.");
          }}
          onCloseSurvey={async (survey) => {
            if (!window.confirm(`Encerrar a pesquisa "${survey.title}"?`)) return;
            await api.post(`/api/admin/surveys/${survey.id}/close`);
            setNotice("Pesquisa encerrada.");
            const list = await api.get<Survey[]>("/api/admin/surveys");
            setAdminSurveys(list);
            setPublicSurveys(await api.get<Survey[]>("/api/surveys"));
            setAdminDetail(await api.get<Detail>(`/api/admin/surveys/${survey.id}`));
          }}
          onDeleteSurvey={async (survey) => {
            if (!window.confirm(`Excluir permanentemente a pesquisa "${survey.title}" e todas as respostas?`)) return;
            await api.delete(`/api/admin/surveys/${survey.id}`);
            setNotice("Pesquisa excluida.");
            setAdminDetail(null);
            setAdminSurveys(await api.get<Survey[]>("/api/admin/surveys"));
            setPublicSurveys(await api.get<Survey[]>("/api/surveys"));
          }}
          onDeleteResponse={async (detail, responseId) => {
            if (!window.confirm("Excluir permanentemente esta resposta e todos os arquivos enviados nela?")) return;
            await api.delete(`/api/admin/responses/${responseId}`);
            setNotice("Resposta excluida.");
            setAdminSurveys(await api.get<Survey[]>("/api/admin/surveys"));
            setAdminDetail(await api.get<Detail>(`/api/admin/surveys/${detail.survey.id}`));
          }}
          onSaved={async (id) => {
            setNotice("Pesquisa criada com sucesso.");
            setCreating(false);
            setBuilderSeed(null);
            setEditingSeed(null);
            setAdminSurveys(await api.get<Survey[]>("/api/admin/surveys"));
            setAdminDetail(await api.get<Detail>(`/api/admin/surveys/${id}`));
            setPublicSurveys(await api.get<Survey[]>("/api/surveys"));
          }}
          builderSeed={builderSeed}
          editingSeed={editingSeed}
        />
      ) : selectedPublic ? (
        <SurveyResponse detail={selectedPublic} onBack={() => setSelectedPublic(null)} onDone={(message) => setNotice(message)} />
      ) : (
        <PublicList surveys={publicSurveys} onOpen={openPublic} onAdminClick={() => setLoginOpen(true)} />
      )}

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLogged={async () => {
            setLoginOpen(false);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

function PublicList({ surveys, onOpen, onAdminClick }: { surveys: Survey[]; onOpen: (survey: Survey) => void; onAdminClick: () => void }) {
  return (
    <section className="publicHome">
      <img className="publicAurora" src="/aurora-pesquisa.png" alt="" aria-hidden="true" />
      <header className="publicHero">
        <div>
          <p className="eyebrow">Pesquisa de preço</p>
          <h1>Pesquisas disponíveis</h1>
          <p>Selecione uma pesquisa para responder e contribuir com informações atualizadas.</p>
        </div>
        <button className="adminIconButton" onClick={onAdminClick} title="Acesso administrativo" aria-label="Acesso administrativo">
          <span className="gearIcon" aria-hidden="true" />
        </button>
      </header>

      <section className="publicGrid">
        {surveys.length === 0 && <div className="empty">Nenhuma pesquisa disponível no momento.</div>}
        {surveys.map((survey) => (
          <article className="publicSurveyCard" key={survey.id}>
            <div className="publicCardTop">
              <span className="availableBadge">
                <span />
                Disponível
              </span>
              {survey.image_url && <img className="publicSurveyImage" src={survey.image_url} alt="Imagem da pesquisa" />}
            </div>
            <h2>{survey.title}</h2>
            <span className="cardDivider" />
            <p>{survey.description || "Pesquisa anônima disponível para resposta."}</p>
            <div className="publicCardFooter">
              <div className="dateIcon" aria-hidden="true" />
              <div>
                <span>Disponível até</span>
                <strong>{formatDate(survey.ends_at)}</strong>
              </div>
            </div>
            <button onClick={() => onOpen(survey)}>
              Responder
              <span className="arrowIcon" aria-hidden="true" />
            </button>
          </article>
        ))}
      </section>
    </section>
  );
}

function LoginModal({ onClose, onLogged }: { onClose: () => void; onLogged: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [allowCredentialsInput, setAllowCredentialsInput] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api.post("/api/admin/login", { login, password });
      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    }
  }

  return (
    <div className="modalBackdrop">
      <form className="modal" onSubmit={submit} autoComplete="off">
        <h2>Acesso administrativo</h2>
        {error && <div className="error">{error}</div>}
        <label>
          Login
          <input
            autoFocus
            name="admin-login-manual"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            readOnly={!allowCredentialsInput}
            value={login}
            onFocus={() => setAllowCredentialsInput(true)}
            onChange={(event) => setLogin(event.target.value)}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            name="admin-password-manual"
            autoComplete="new-password"
            readOnly={!allowCredentialsInput}
            value={password}
            onFocus={() => setAllowCredentialsInput(true)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button>Entrar</button>
        </div>
      </form>
    </div>
  );
}

function SurveyResponse({ detail, onBack, onDone }: { detail: Detail; onBack: () => void; onDone: (message: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const completedCount = detail.questions.filter((question) => {
    const answer = answers[question.id] as PublicAnswer | undefined;
    const value = answer && typeof answer === "object" && !Array.isArray(answer) ? answer.value : answer;
    return Boolean(answer?.noAnswer && answer.reason) || hasAnswerValue(value) || Boolean(files[question.id]?.length) || Boolean(answer?.fileUnavailable && answer.fileUnavailableReason);
  }).length;
  const progress = detail.questions.length ? Math.round((completedCount / detail.questions.length) * 100) : 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setFeedback(null);
    try {
      for (const question of detail.questions) {
        const answer = (answers[question.id] && typeof answers[question.id] === "object" && !Array.isArray(answers[question.id]) ? answers[question.id] : { value: answers[question.id] }) as PublicAnswer;
        const noAnswer = Boolean(answer.noAnswer);
        const questionHasFile = Boolean(question.has_file || question.hasFile || question.kind === "upload");
        const questionFiles = files[question.id] || [];
        if (noAnswer && !String(answer.reason || "").trim()) throw new Error(`Justifique por que não pode responder: ${question.title}`);
        if (!noAnswer && answer.fileUnavailable && !String(answer.fileUnavailableReason || "").trim()) throw new Error(`Justifique por que não consegue tirar a foto: ${question.title}`);
        if (question.required && !noAnswer && question.kind !== "upload" && !hasAnswerValue(answer.value)) throw new Error(`Responda: ${question.title}`);
        if (question.required && !noAnswer && questionHasFile && !answer.fileUnavailable && questionFiles.length === 0) throw new Error(`Envie uma foto ou justifique a falta da foto: ${question.title}`);
      }
      const body = new FormData();
      body.append("answers", JSON.stringify(answers));
      Object.entries(files).forEach(([id, fileList]) => fileList.forEach((file) => body.append(`file_${id}`, file)));
      await api.post(`/api/surveys/${detail.survey.id}/responses`, body);
      setSent(true);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Erro ao enviar resposta." });
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <section className="responseShell">
        <img className="responseAurora" src="/aurora-pesquisa.png" alt="" aria-hidden="true" />
        <div className="responseTopbar">
          <strong>Pesquisa de preço</strong>
        </div>
        <div className="sentCard">
          <h2>Resposta gravada com sucesso.</h2>
          <button onClick={onBack}>Voltar</button>
        </div>
      </section>
    );
  }

  return (
    <section className="responseShell">
      <img className="responseAurora" src="/aurora-pesquisa.png" alt="" aria-hidden="true" />
      <div className="responseTopbar">
        <div className="responseBrand">
          <strong>Pesquisa de preço</strong>
        </div>
        <button type="button" className="responseGhost" onClick={onBack} disabled={sending}>
          Voltar
        </button>
      </div>
      <form className="responseLayout" onSubmit={submit}>
        {feedback && <FeedbackToast type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />}
        <aside className="progressCard">
          <h2>Progresso da pesquisa</h2>
          <p>
            {completedCount} de {detail.questions.length} respondidas
          </p>
          <div className="progressTrack">
            <span style={{ width: `${progress}%` }} />
          </div>
          <strong>{progress}%</strong>
          <ol className="progressSteps">
            {detail.questions.map((question, index) => (
              <li className={index < completedCount ? "done" : ""} key={question.id}>
                <span>{index + 1}</span>
                {question.title || `Pergunta ${index + 1}`}
              </li>
            ))}
          </ol>
        </aside>
        <div className="responseMain">
          <header className="surveyHero">
            <div className="surveyHeroMain">
              <img className="omegaHeroLogo" src="/omega-logo.png" alt="Omega Distribuidora" />
              <div>
                <h2>{detail.survey.title}</h2>
                <p>{detail.survey.description}</p>
                <div className="heroMeta">
                  <span>Prazo: {formatDate(detail.survey.ends_at)}</span>
                  <span className="statusPill isopen">Aberta</span>
                </div>
              </div>
            </div>
            {detail.survey.image_url && (
              <img className="surveyHeroImage" src={detail.survey.image_url} alt="Imagem da pesquisa" />
            )}
          </header>
          <div className="questionPanel">
            {detail.questions.map((question, index) => (
              <QuestionInput
                key={question.id}
                index={index}
                question={question}
                value={answers[question.id]}
                files={files[question.id] || []}
                onAnswer={(answer) => setAnswers((current) => ({ ...current, [question.id]: answer }))}
                onFiles={(nextFiles) => setFiles((current) => ({ ...current, [question.id]: nextFiles }))}
              />
            ))}
          </div>
        </div>
        <div className="responseSubmitBar">
          <button type="button" className="secondary" onClick={onBack} disabled={sending}>
            Voltar
          </button>
          <button disabled={sending}>{sending ? "Enviando..." : "Enviar respostas"}</button>
        </div>
      </form>
    </section>
  );
}

function FeedbackToast({ type, message, onClose }: { type: "success" | "error"; message: string; onClose: () => void }) {
  return (
    <div className={`feedbackToast ${type}`}>
      <span>{message}</span>
      <button type="button" className="link" onClick={onClose}>
        Fechar
      </button>
    </div>
  );
}

function QuestionInput({
  index,
  question,
  value,
  files,
  onAnswer,
  onFiles
}: {
  index: number;
  question: Question;
  value: unknown;
  files: File[];
  onAnswer: (answer: PublicAnswer) => void;
  onFiles: (files: File[]) => void;
}) {
  const textType = question.text_type || question.textType || "text";
  const hasFile = question.has_file || question.hasFile || question.kind === "upload";
  const fileMaxMb = question.file_max_mb || question.fileMaxMb || 5;
  const answer = value && typeof value === "object" && !Array.isArray(value) ? (value as PublicAnswer) : { value };
  const fieldValue = answer.value;
  const noAnswer = Boolean(answer.noAnswer);
  const fileUnavailable = Boolean(answer.fileUnavailable);
  const [fileError, setFileError] = useState("");
  const [preparingFiles, setPreparingFiles] = useState(false);

  function updateAnswer(patch: Partial<PublicAnswer>) {
    onAnswer({ ...answer, ...patch });
  }

  async function addFiles(selected: File[]) {
    if (!selected.length) return;
    setFileError("");
    setPreparingFiles(true);
    try {
      const prepared = await prepareFilesForUpload(selected, fileMaxMb);
      onFiles([...files, ...prepared]);
      if (fileUnavailable) updateAnswer({ fileUnavailable: false, fileUnavailableReason: "" });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Erro ao preparar arquivo.");
    } finally {
      setPreparingFiles(false);
    }
  }

  function updateText(raw: string) {
    if (textType === "integer") updateAnswer({ value: raw.replace(/\D/g, "") });
    else if (textType === "currency") updateAnswer({ value: normalizeCurrency(raw) });
    else if (textType === "decimal") updateAnswer({ value: normalizeDecimalInput(raw) });
    else updateAnswer({ value: raw });
  }

  return (
    <fieldset className="question">
      <legend>
        {index + 1}. {question.title} {question.required && <strong>*</strong>}
      </legend>
      <span className="questionHint">{question.required ? "Resposta obrigatória" : "Resposta opcional"}</span>
      {question.image_url && <img className="questionImage" src={question.image_url} alt={`Imagem da pergunta ${index + 1}`} />}
      {question.kind === "short_text" && (
        <input disabled={noAnswer} required={question.required && !noAnswer} value={String(fieldValue || "")} onChange={(event) => updateText(event.target.value)} />
      )}
      {question.kind === "long_text" && (
        <textarea disabled={noAnswer} required={question.required && !noAnswer} value={String(fieldValue || "")} onChange={(event) => updateText(event.target.value)} rows={5} />
      )}
      {question.kind === "dropdown" && (
        <select disabled={noAnswer} required={question.required && !noAnswer} value={String(fieldValue || "")} onChange={(event) => updateAnswer({ value: event.target.value })}>
          <option value="">Selecione</option>
          {question.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      )}
      {question.kind === "options" && (
        <div className="choiceList">
          {question.options.map((option) => (
            <label key={option} className="choice">
              <input
                type={question.multiple ? "checkbox" : "radio"}
                name={question.id}
                disabled={noAnswer || preparingFiles}
                checked={question.multiple ? Array.isArray(fieldValue) && fieldValue.includes(option) : fieldValue === option}
                onChange={(event) => {
                  if (question.multiple) {
                    const current = Array.isArray(fieldValue) ? fieldValue : [];
                    updateAnswer({ value: event.target.checked ? [...current, option] : current.filter((item) => item !== option) });
                  } else {
                    updateAnswer({ value: option });
                  }
                }}
              />
              {option}
            </label>
          ))}
        </div>
      )}
      {question.kind === "rating" && (
        <div className="stars">
          {[1, 2, 3, 4, 5].map((star) => (
            <button type="button" disabled={noAnswer} className={Number(fieldValue) >= star ? "active" : ""} key={star} onClick={() => updateAnswer({ value: star })} aria-label={`Nota ${star}`}>
              ★
            </button>
          ))}
        </div>
      )}
      {hasFile && (
        <div className="fileBox">
          <div>
            <strong>Arquivos até {fileMaxMb} MB cada</strong>
            <span className="fileHelpText">Adicione uma ou mais fotos/arquivos.</span>
          </div>
          <div className="fileActions">
            <label className="fileActionButton">
              + Adicionar foto
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                disabled={noAnswer || preparingFiles}
                onChange={async (event) => {
                  const selected = Array.from(event.target.files || []);
                  await addFiles(selected);
                  event.target.value = "";
                }}
              />
            </label>
            <label className="fileActionButton">
              Tirar foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={noAnswer}
                onChange={async (event) => {
                  const selected = Array.from(event.target.files || []);
                  await addFiles(selected);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {preparingFiles && <span className="fileHelpText">Preparando imagem...</span>}
          {fileError && <div className="inlineError">{fileError}</div>}
          {files.length > 0 && (
            <ul className="fileList">
              {files.map((file, fileIndex) => (
                <li key={`${file.name}-${file.lastModified}-${fileIndex}`}>
                  <span>{file.name}</span>
                  <button type="button" className="link" onClick={() => onFiles(files.filter((_, indexToKeep) => indexToKeep !== fileIndex))}>
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
          {question.required && (
            <div className="noAnswerBox fileUnavailableBox">
              <label className="inline">
                <input
                  type="checkbox"
                  disabled={noAnswer || preparingFiles}
                  checked={fileUnavailable}
                  onChange={(event) => {
                    updateAnswer({ fileUnavailable: event.target.checked, fileUnavailableReason: event.target.checked ? answer.fileUnavailableReason || "" : "" });
                    if (event.target.checked) onFiles([]);
                  }}
                />
                Não consigo tirar a foto
              </label>
              {fileUnavailable && !noAnswer && (
                <textarea
                  className="reasonInput"
                  rows={2}
                  required
                  placeholder="Justifique brevemente"
                  value={String(answer.fileUnavailableReason || "")}
                  onChange={(event) => updateAnswer({ fileUnavailableReason: event.target.value })}
                />
              )}
            </div>
          )}
        </div>
      )}
      {question.required && (
        <div className="noAnswerBox">
          <label className="inline">
            <input
              type="checkbox"
              checked={noAnswer}
              onChange={(event) => {
                updateAnswer({
                  noAnswer: event.target.checked,
                  value: event.target.checked ? "" : answer.value,
                  fileUnavailable: event.target.checked ? false : answer.fileUnavailable,
                  fileUnavailableReason: event.target.checked ? "" : answer.fileUnavailableReason
                });
                if (event.target.checked) onFiles([]);
              }}
            />
            Não tenho uma resposta
          </label>
          {noAnswer && (
            <textarea
              className="reasonInput"
              rows={2}
              required
              placeholder="Justifique brevemente"
              value={String(answer.reason || "")}
              onChange={(event) => updateAnswer({ reason: event.target.value })}
            />
          )}
        </div>
      )}
    </fieldset>
  );
}

function AdminArea({
  surveys,
  detail,
  creating,
  onCreate,
  onOpen,
  onEdit,
  onCloseSurvey,
  onDeleteSurvey,
  onDeleteResponse,
  onCopy,
  builderSeed,
  editingSeed,
  onSaved
}: {
  surveys: Survey[];
  detail: Detail | null;
  creating: boolean;
  onCreate: () => void;
  onOpen: (survey: Survey) => void;
  onEdit: (detail: Detail) => void;
  onCloseSurvey: (survey: Survey) => void;
  onDeleteSurvey: (survey: Survey) => void;
  onDeleteResponse: (detail: Detail, responseId: string) => void;
  onCopy: (detail: Detail) => void;
  builderSeed: Detail | null;
  editingSeed: Detail | null;
  onSaved: (id: string) => void;
}) {
  return (
    <section className="adminLayout">
      <aside className="sidebar">
        <button onClick={onCreate}>Nova pesquisa</button>
        <h2>Pesquisas</h2>
        {surveys.map((survey) => (
          <div className={`surveyButtonWrap is${surveyStatus(survey)}`} key={survey.id}>
            <button className="surveyButton" onClick={() => onOpen(survey)}>
              <span>{survey.title}</span>
              <small>{survey.response_count || 0} respostas</small>
              <em>{surveyStatusLabel(survey)}</em>
            </button>
            {isSurveyOpen(survey) && (
              <button className="danger compactButton" onClick={() => onCloseSurvey(survey)}>
                Encerrar
              </button>
            )}
            <button className="danger compactButton" onClick={() => onDeleteSurvey(survey)}>
              Excluir
            </button>
          </div>
        ))}
      </aside>
      <div className="workspace">
        {creating ? (
          <SurveyBuilder onSaved={onSaved} seed={builderSeed} editing={editingSeed} />
        ) : detail ? (
          <AdminDetail detail={detail} onCloseSurvey={() => onCloseSurvey(detail.survey)} onDeleteSurvey={() => onDeleteSurvey(detail.survey)} onDeleteResponse={(responseId) => onDeleteResponse(detail, responseId)} onCopy={() => onCopy(detail)} onEdit={() => onEdit(detail)} />
        ) : (
          <div className="empty">Selecione ou crie uma pesquisa.</div>
        )}
      </div>
    </section>
  );
}

function SurveyBuilder({ onSaved, seed, editing }: { onSaved: (id: string) => void; seed: Detail | null; editing: Detail | null }) {
  const now = useMemo(() => inputDateTime(), []);
  const tomorrow = useMemo(() => inputDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000)), []);
  const source = editing || seed;
  const [title, setTitle] = useState(editing ? editing.survey.title : seed ? `${seed.survey.title} (cópia)` : "");
  const [description, setDescription] = useState(source?.survey.description || "");
  const [imageUrl, setImageUrl] = useState(source?.survey.image_url || "");
  const [startsAt, setStartsAt] = useState(editing ? inputDateTime(new Date(editing.survey.starts_at)) : now);
  const [endsAt, setEndsAt] = useState(editing ? inputDateTime(new Date(editing.survey.ends_at)) : tomorrow);
  const [questions, setQuestions] = useState<Question[]>(
    source
      ? source.questions.map((question) => ({
          id: editing ? question.id : crypto.randomUUID(),
          title: question.title,
          kind: question.kind,
          required: question.required,
          textType: question.text_type || question.textType || "text",
          options: question.options || [],
          multiple: question.multiple,
          hasFile: question.has_file || question.hasFile || false,
          fileMaxMb: question.file_max_mb || question.fileMaxMb || 5
        }))
      : [questionDefaults()]
  );
  const [questionImages, setQuestionImages] = useState<Record<string, File | null>>({});
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = {
        title,
        description,
        imageUrl,
        startsAt: localDateTimeToIso(startsAt),
        endsAt: localDateTimeToIso(endsAt),
        questions: questions.map((question) => ({
          id: question.id,
          title: question.title,
          kind: question.kind,
          required: question.required,
          textType: question.textType,
          options: question.options,
          multiple: question.multiple,
          hasFile: question.hasFile,
          fileMaxMb: question.fileMaxMb
        }))
      };
      const body = new FormData();
      body.append("payload", JSON.stringify(payload));
      Object.entries(questionImages).forEach(([questionId, file]) => {
        if (file) body.append(`question_image_${questionId}`, file);
      });
      const result = editing
        ? await api.put<{ id: string }>(`/api/admin/surveys/${editing.survey.id}`, body)
        : await api.post<{ id: string }>("/api/admin/surveys", body);
      onSaved(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    }
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setQuestions((current) => current.map((question) => (question.id === id ? { ...question, ...patch } : question)));
  }

  return (
    <form className="panel form" onSubmit={save}>
      <h2>{editing ? "Editar pesquisa" : seed ? "Nova pesquisa a partir de cópia" : "Nova pesquisa"}</h2>
      {error && <div className="error">{error}</div>}
      <div className="twoCols">
        <label>
          Título
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Descrição
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Imagem da pesquisa (URL)
          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." />
        </label>
        <label>
          Início
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label>
          Fim
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
      </div>
      <div className="builderHeader">
        <h3>Perguntas</h3>
      </div>
      {questions.map((question, index) => (
        <div className="builderItem" key={question.id}>
          <div className="builderTitle">
            <strong>{index + 1}</strong>
            <input placeholder="Título da pergunta" value={question.title} onChange={(event) => updateQuestion(question.id, { title: event.target.value })} required />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setQuestions((current) => current.filter((item) => item.id !== question.id));
                setQuestionImages((current) => {
                  const next = { ...current };
                  delete next[question.id];
                  return next;
                });
              }}
            >
              Remover
            </button>
          </div>
          <label>
            Foto de apoio da pergunta
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setQuestionImages((current) => ({ ...current, [question.id]: event.target.files?.[0] || null }))}
            />
            {questionImages[question.id] && <span className="builderFileName">{questionImages[question.id]?.name}</span>}
          </label>
          <div className="twoCols">
            <label>
              Tipo
              <select value={question.kind} onChange={(event) => updateQuestion(question.id, { kind: event.target.value as QuestionKind })}>
                <option value="short_text">Resposta curta</option>
                <option value="long_text">Resposta longa</option>
                <option value="options">Seletor de opções</option>
                <option value="dropdown">Lista suspensa</option>
                <option value="rating">Classificação</option>
                <option value="upload">Upload avulso</option>
              </select>
            </label>
            {(question.kind === "short_text" || question.kind === "long_text") && (
              <label>
                Tipo de texto
                <select value={question.textType} onChange={(event) => updateQuestion(question.id, { textType: event.target.value as TextType })}>
                  <option value="text">Texto</option>
                  <option value="integer">Número inteiro</option>
                  <option value="decimal">Número decimal</option>
                  <option value="currency">Moeda</option>
                </select>
              </label>
            )}
          </div>
          {(question.kind === "options" || question.kind === "dropdown") && (
            <label>
              Opções, uma por linha
              <textarea
                rows={4}
                value={question.options.join("\n")}
                onChange={(event) => updateQuestion(question.id, { options: event.target.value.split("\n") })}
              />
            </label>
          )}
          {question.kind === "options" && (
            <label className="inline">
              <input type="checkbox" checked={question.multiple} onChange={(event) => updateQuestion(question.id, { multiple: event.target.checked })} />
              Permitir múltipla escolha
            </label>
          )}
          <div className="inlineRow">
            <label className="inline">
              <input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />
              Obrigatória
            </label>
            {question.kind !== "upload" && (
              <label className="inline">
                <input type="checkbox" checked={question.hasFile} onChange={(event) => updateQuestion(question.id, { hasFile: event.target.checked })} />
                Permitir upload junto
              </label>
            )}
            {(question.hasFile || question.kind === "upload") && (
              <label className="compact">
                Limite MB
                <input type="number" min={1} max={50} value={question.fileMaxMb} onChange={(event) => updateQuestion(question.id, { fileMaxMb: Number(event.target.value) })} />
              </label>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="secondary addQuestionButton" onClick={() => setQuestions((current) => [...current, questionDefaults()])}>
        Adicionar pergunta
      </button>
      <button>Salvar pesquisa</button>
    </form>
  );
}

function AdminDetail({
  detail,
  onCloseSurvey,
  onDeleteSurvey,
  onDeleteResponse,
  onCopy,
  onEdit
}: {
  detail: Detail;
  onCloseSurvey: () => void;
  onDeleteSurvey: () => void;
  onDeleteResponse: (responseId: string) => void;
  onCopy: () => void;
  onEdit: () => void;
}) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  return (
    <section className="panel">
      <div className="detailHeader">
        <div>
          <h2>{detail.survey.title}</h2>
          <p>{detail.survey.description}</p>
          <span>
            {formatDate(detail.survey.starts_at)} até {formatDate(detail.survey.ends_at)}
          </span>
          <div className={`statusPill is${surveyStatus(detail.survey)}`}>{surveyStatusLabel(detail.survey)}</div>
        </div>
        <div className="inlineActions">
          {isSurveyOpen(detail.survey) && (
            <button className="danger" onClick={onCloseSurvey}>
              Encerrar pesquisa
            </button>
          )}
          <button className="secondary" onClick={onCopy}>
            Criar uma cópia
          </button>
          <button className="secondary" onClick={onEdit}>
            Editar pesquisa
          </button>
          <a className="button" href={`/api/admin/surveys/${detail.survey.id}/export`}>
            Exportar Excel
          </a>
          <button className="danger" onClick={onDeleteSurvey}>
            Excluir pesquisa
          </button>
        </div>
      </div>
      <div className="stats">
        <strong>{detail.responses?.length || 0}</strong>
        <span>respostas recebidas</span>
      </div>
      <h3>Prévia das respostas</h3>
      <div className="responses">
        {detail.responses?.length === 0 && <div className="empty">Ainda sem respostas.</div>}
        {detail.responses?.map((response) => (
          <article className="responseCard" key={response.id}>
            <div className="responseCardHeader">
              <strong>{formatDate(response.submitted_at)}</strong>
              <button className="danger compactButton" onClick={() => onDeleteResponse(response.id)}>
                Excluir resposta
              </button>
            </div>
            {detail.questions.map((question) => {
              const answer = response.answers?.[question.id];
              return (
              <div className="answer" key={question.id}>
                <span>{question.title}</span>
                <div className="answerValue">{answer ? renderAnswer(answer, setPreview) : "Sem resposta"}</div>
              </div>
              );
            })}
          </article>
        ))}
      </div>
      <h3>Últimas tentativas de envio</h3>
      <div className="submissionLogList">
        {detail.submissionLogs?.length === 0 && <div className="empty">Ainda sem tentativas registradas.</div>}
        {detail.submissionLogs?.map((log) => (
          <article className={`submissionLog is${log.status}`} key={log.id}>
            <div>
              <strong>{formatDate(log.created_at)}</strong>
              <span>{submissionStatusLabel(log.status)}</span>
            </div>
            <p>{log.error_message || (log.status === "success" ? "Resposta gravada com sucesso." : "Envio iniciado.")}</p>
          </article>
        ))}
      </div>
      {preview && (
        <div className="imagePreviewBackdrop" onClick={() => setPreview(null)}>
          <div className="imagePreviewModal" onClick={(event) => event.stopPropagation()}>
            <button className="imagePreviewClose" onClick={() => setPreview(null)} aria-label="Fechar">
              X
            </button>
            <img src={preview.url} alt={preview.name} />
          </div>
        </div>
      )}
    </section>
  );
}

function renderAnswer(answer: AdminAnswer, openPreview: (preview: { url: string; name: string }) => void): React.ReactNode {
  if (answer.noAnswer) return `Não tenho uma resposta: ${answer.noAnswerReason || "sem justificativa"}`;
  const fileUnavailableText = answer.fileUnavailable ? `Não consigo tirar a foto: ${answer.fileUnavailableReason || "sem justificativa"}` : "";
  const valueText = answer.valueText === "[object Object]" ? "" : answer.valueText;
  const baseValue = valueText || (answer.valueNumber ? (answer.kind === "rating" ? `${answer.valueNumber} estrela(s)` : String(answer.valueNumber)) : "") || (Array.isArray(answer.valueJson) ? answer.valueJson.join(", ") : answer.valueJson ? String(answer.valueJson) : "");
  const allFiles = answer.files || [];
  const imageFiles = allFiles.filter((file, index, list) => file.fileMime?.startsWith("image/") && file.fileUrl && list.findIndex((item) => item.fileUrl === file.fileUrl) === index);
  const otherFiles = allFiles.filter((file) => !(file.fileMime?.startsWith("image/") && file.fileUrl));
  const hasSingleImage = Boolean(answer.fileUrl && answer.fileName && answer.fileMime?.startsWith("image/") && !imageFiles.some((file) => file.fileUrl === answer.fileUrl));

  if (baseValue || fileUnavailableText || imageFiles.length || otherFiles.length || hasSingleImage || answer.fileName) {
    return (
      <div className="answerStack">
        {baseValue && <p>{baseValue}</p>}
        {fileUnavailableText && <p>{fileUnavailableText}</p>}
        {imageFiles.length > 0 && (
          <div className="answerImageGrid">
            {imageFiles.map((file) => (
              <button type="button" onClick={() => openPreview({ url: file.fileUrl || "", name: file.fileName })} key={`${file.fileUrl}-${file.fileName}`}>
                <img src={file.fileUrl} alt={file.fileName} />
              </button>
            ))}
          </div>
        )}
        {otherFiles.length > 0 && <p>{otherFiles.map((file) => file.fileName).join(", ")}</p>}
        {hasSingleImage && (
          <button type="button" onClick={() => openPreview({ url: answer.fileUrl || "", name: answer.fileName || "Imagem" })} className="answerSingleImage">
            <img src={answer.fileUrl} alt={answer.fileName} />
          </button>
        )}
        {!imageFiles.length && !hasSingleImage && answer.fileName && <p>{answer.fileName}</p>}
      </div>
    );
  }

  return "Sem resposta";
}

createRoot(document.getElementById("root")!).render(<App />);
