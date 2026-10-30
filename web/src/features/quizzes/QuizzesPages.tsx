import clsx from "clsx";
import { CheckCircle2, Clock, FileQuestion, Pencil, Play, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { MarkdownEditor } from "../../components/ui/markdown-editor";
import { Badge, Button, Card, CardHeader, Checkbox, Dialog, EmptyState, FormError, IconButton, Loadable, PageHeader, RichContent, SelectField, Table, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDateTime, formatPoints, fromLocalInput, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { AssignmentGroup, Attempt, AttemptQuestion, Quiz, QuizQuestion, QuizResponse } from "../../lib/types";
import { ModuleNav } from "../content/ModuleNav";

const TYPE_LABEL = { multiple_choice: "Multiple choice", multiple_select: "Multiple answers", true_false: "True / false", short_answer: "Short answer" } as const;

// ====================================================================== list
export function QuizzesList() {
  const { course, base, permissions } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: Quiz[] }>(`/courses/${course.id}/quizzes`);
  const create = async () => {
    try {
      const r = await api.post<{ quiz: Quiz }>(`/courses/${course.id}/quizzes`, { title: "Untitled quiz" });
      await invalidate(`/courses/${course.id}`);
      navigate(`${base}/quizzes/${r.quiz.id}?tab=settings`);
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <>
      <PageHeader title="Quizzes" actions={permissions.canEditContent && <Button icon={<Plus className="size-4" />} onClick={() => void create()}>Quiz</Button>} />
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState icon={<FileQuestion className="size-6" />} title="No quizzes yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.data.map((z) => (
                  <li key={z.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <FileQuestion className="size-4 text-slate-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link to={`${base}/quizzes/${z.id}`} className="text-sm font-medium hover:text-brand-700">
                        {z.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {z.dueAt ? `Due ${formatDateTime(z.dueAt)}` : "No due date"} · {formatPoints(z.pointsPossible)} pts · {z.questionCount} questions
                        {z.timeLimitMinutes && ` · ${z.timeLimitMinutes} min`}
                        {z.quizType === "practice" && " · Practice"}
                      </div>
                    </div>
                    {permissions.isStaff ? (
                      <span className="flex gap-1">
                        {!z.published && <Badge tone="amber">Draft</Badge>}
                        {!!z.pendingReview && <Badge tone="violet">{z.pendingReview} to review</Badge>}
                        <Badge>{z.submittedAttempts ?? 0} attempts</Badge>
                      </span>
                    ) : (
                      <span className="flex gap-1">
                        {z.keptScore !== null && z.keptScore !== undefined && <Badge tone="green">{formatPoints(z.keptScore)} / {formatPoints(z.pointsPossible)}</Badge>}
                        {z.inProgressAttemptId && <Badge tone="blue">In progress</Badge>}
                        <Badge>{z.attemptsUsed ?? 0} / {z.allowedAttempts ?? "∞"} attempts</Badge>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>
    </>
  );
}

// ====================================================================== quiz page (staff manage / student overview)
export function QuizPage() {
  const { quizId } = useParams();
  const { permissions } = useCourse();
  return permissions.isStaff ? <QuizManager quizId={quizId!} /> : <QuizOverview quizId={quizId!} />;
}

function QuizOverview({ quizId }: { quizId: string }) {
  const { base, course } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ quiz: Quiz; attempts: Omit<Attempt, "questions" | "visibility">[]; keptScore: number | null; startBlockReason: string | null; visibility: Attempt["visibility"] }>(`/quizzes/${quizId}`);
  useEffect(() => {
    if (q.isSuccess) void invalidate(`/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isSuccess]);
  const start = async () => {
    try {
      const r = await api.post<{ attempt: Attempt }>(`/quizzes/${quizId}/attempts`);
      navigate(`${base}/quizzes/${quizId}/attempts/${r.attempt.id}/take`);
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <Loadable query={q}>
      {(d) => {
        const open = d.attempts.find((a) => a.status === "in_progress");
        return (
          <article className="space-y-6">
            <PageHeader title={d.quiz.title} />
            <Card className="grid gap-4 p-5 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-slate-500">Due</div><div className="font-medium">{d.quiz.dueAt ? formatDateTime(d.quiz.dueAt) : "No due date"}</div></div>
              <div><div className="text-xs text-slate-500">Points</div><div className="font-medium">{formatPoints(d.quiz.pointsPossible)} · {d.quiz.questionCount} questions</div></div>
              <div><div className="text-xs text-slate-500">Time limit</div><div className="font-medium">{d.quiz.timeLimitMinutes ? `${d.quiz.timeLimitMinutes} minutes` : "None"}</div></div>
              <div><div className="text-xs text-slate-500">Attempts</div><div className="font-medium">{d.attempts.filter((a) => a.submittedAt).length} of {d.quiz.allowedAttempts ?? "unlimited"} · {d.quiz.scoringPolicy === "keep_highest" ? "highest counts" : "latest counts"}</div></div>
              {(d.quiz.unlockAt || d.quiz.lockAt) && <div className="text-xs text-slate-500 sm:col-span-4">Available {d.quiz.unlockAt ? `from ${formatDateTime(d.quiz.unlockAt)}` : "now"} {d.quiz.lockAt ? `until ${formatDateTime(d.quiz.lockAt)}` : ""}</div>}
            </Card>
            {d.quiz.descriptionHtml && <Card className="p-6"><RichContent html={d.quiz.descriptionHtml} /></Card>}
            <Card className="flex flex-wrap items-center gap-4 p-5">
              <div className="mr-auto text-sm">
                {d.keptScore !== null ? (
                  <span>Score kept: <strong className="text-lg">{formatPoints(d.keptScore)} / {formatPoints(d.quiz.pointsPossible)}</strong></span>
                ) : d.attempts.some((a) => a.submittedAt) ? (
                  <span className="text-slate-600">Your score will appear once your instructor releases it.</span>
                ) : (
                  <span className="text-slate-600">{d.quiz.timeLimitMinutes ? `Once you start, you have ${d.quiz.timeLimitMinutes} minutes. The timer keeps running if you leave.` : "Answers are saved as you go."}</span>
                )}
              </div>
              {open ? (
                <Button icon={<Play className="size-4" />} onClick={() => navigate(`${base}/quizzes/${quizId}/attempts/${open.id}/take`)}>Resume attempt</Button>
              ) : d.startBlockReason ? (
                <span className="text-sm text-slate-600">{d.startBlockReason}</span>
              ) : (
                <Button icon={<Play className="size-4" />} onClick={() => void start()}>{d.attempts.length ? "Start new attempt" : "Start quiz"}</Button>
              )}
            </Card>
            {d.attempts.some((a) => a.submittedAt) && (
              <Card>
                <CardHeader title="Your attempts" />
                <Table>
                  <thead><tr><th>Attempt</th><th>Submitted</th><th>Status</th><th className="text-right">Score</th><th /></tr></thead>
                  <tbody>
                    {d.attempts.filter((a) => a.submittedAt).map((a) => (
                      <tr key={a.id}>
                        <td>#{a.attemptNumber}</td>
                        <td className="text-slate-600">{formatDateTime(a.submittedAt)}</td>
                        <td>{a.status === "pending_review" ? <Badge tone="blue">Awaiting review</Badge> : <Badge tone="green">Submitted</Badge>}</td>
                        <td className="text-right">{a.score === null ? "—" : `${formatPoints(a.score)} / ${formatPoints(a.pointsPossible)}`}</td>
                        <td className="text-right"><Link className="text-sm font-medium text-brand-700 hover:underline" to={`${base}/quizzes/${quizId}/attempts/${a.id}`}>View</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}
            <ModuleNav refId={quizId} />
          </article>
        );
      }}
    </Loadable>
  );
}

function QuizManager({ quizId }: { quizId: string }) {
  const { base } = useCourse();
  const [tab, setTab] = useState<"questions" | "settings" | "attempts">(() => (new URLSearchParams(location.search).get("tab") as "settings" | null) ?? "questions");
  const q = useApi<{ quiz: Quiz }>(`/quizzes/${quizId}`);
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const togglePublish = async (quiz: Quiz) => {
    try {
      await api.patch(`/quizzes/${quiz.id}`, { published: !quiz.published });
      await invalidate(`/quizzes/${quiz.id}`, `/courses/${quiz.courseId}`);
      fb.success(quiz.published ? "Quiz unpublished." : "Quiz published. Students have been notified.");
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <Loadable query={q}>
      {({ quiz }) => (
        <>
          <PageHeader
            eyebrow={<Link to={`${base}/quizzes`} className="hover:underline">← Quizzes</Link>}
            title={quiz.title}
            description={`${quiz.questionCount} questions · ${formatPoints(quiz.pointsPossible)} points${quiz.quizType === "practice" ? " · practice (not graded)" : ""}`}
            actions={<><Badge tone={quiz.published ? "green" : "amber"}>{quiz.published ? "Published" : "Draft"}</Badge><Button variant={quiz.published ? "secondary" : "primary"} onClick={() => void togglePublish(quiz)}>{quiz.published ? "Unpublish" : "Publish"}</Button></>}
          />
          <div role="tablist" aria-label="Quiz sections" className="mb-5 flex gap-1 border-b border-slate-200">
            {(["questions", "settings", "attempts"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize", tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900")}>
                {t}
              </button>
            ))}
          </div>
          {tab === "questions" && <QuestionsEditor quiz={quiz} />}
          {tab === "settings" && <QuizSettings quiz={quiz} />}
          {tab === "attempts" && <AttemptsList quiz={quiz} />}
        </>
      )}
    </Loadable>
  );
}

function QuizSettings({ quiz }: { quiz: Quiz }) {
  const { course, base } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const groups = useApi<{ data: AssignmentGroup[] }>(`/courses/${course.id}/assignment-groups`);
  const [f, setF] = useState({
    title: quiz.title,
    description: quiz.description ?? "",
    timeLimitMinutes: quiz.timeLimitMinutes ? String(quiz.timeLimitMinutes) : "",
    allowedAttempts: quiz.allowedAttempts === null ? "" : String(quiz.allowedAttempts),
    scoringPolicy: quiz.scoringPolicy,
    shuffleAnswers: quiz.shuffleAnswers,
    hideResults: quiz.hideResults,
    showCorrectAnswers: quiz.showCorrectAnswers,
    showCorrectAnswersAt: toLocalInput(quiz.showCorrectAnswersAt),
    unlockAt: toLocalInput(quiz.unlockAt),
    dueAt: toLocalInput(quiz.dueAt),
    lockAt: toLocalInput(quiz.lockAt),
    postManually: quiz.postManually ?? false,
    groupId: quiz.groupId ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/quizzes/${quiz.id}`, {
        title: f.title,
        description: f.description,
        timeLimitMinutes: f.timeLimitMinutes ? Number(f.timeLimitMinutes) : null,
        allowedAttempts: f.allowedAttempts ? Number(f.allowedAttempts) : null,
        scoringPolicy: f.scoringPolicy,
        shuffleAnswers: f.shuffleAnswers,
        hideResults: f.hideResults,
        showCorrectAnswers: f.showCorrectAnswers,
        showCorrectAnswersAt: fromLocalInput(f.showCorrectAnswersAt),
        unlockAt: fromLocalInput(f.unlockAt),
        dueAt: fromLocalInput(f.dueAt),
        lockAt: fromLocalInput(f.lockAt),
        ...(quiz.assignmentId ? { postManually: f.postManually, ...(f.groupId ? { groupId: f.groupId } : {}) } : {}),
      });
      await invalidate(`/quizzes/${quiz.id}`, `/courses/${course.id}`, "/calendar");
      fb.success("Quiz settings saved.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await fb.confirm({ title: "Delete quiz?", message: "The quiz, its questions, all attempts and its gradebook column are permanently deleted.", confirmLabel: "Delete quiz", danger: true }))) return;
    try {
      await api.del(`/quizzes/${quiz.id}`);
      await invalidate(`/courses/${course.id}`);
      navigate(`${base}/quizzes`);
    } catch (err) {
      fb.error(err);
    }
  };
  const fe = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <form onSubmit={save} className="space-y-5">
      <Card className="space-y-5 p-6">
        <FormError error={error} />
        <TextField label="Title" required value={f.title} onChange={(e) => set({ title: e.target.value })} error={fe.title} />
        <MarkdownEditor label="Instructions" value={f.description} onChange={(v) => set({ description: v })} rows={6} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Time limit (minutes)" type="number" min={1} max={600} placeholder="No limit" value={f.timeLimitMinutes} onChange={(e) => set({ timeLimitMinutes: e.target.value })} />
          <TextField label="Allowed attempts" type="number" min={1} max={100} placeholder="Unlimited" value={f.allowedAttempts} onChange={(e) => set({ allowedAttempts: e.target.value })} />
          <SelectField label="Score to keep" value={f.scoringPolicy} onChange={(e) => set({ scoringPolicy: e.target.value as Quiz["scoringPolicy"] })}>
            <option value="keep_highest">Highest attempt</option>
            <option value="keep_latest">Latest attempt</option>
          </SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Available from" type="datetime-local" value={f.unlockAt} onChange={(e) => set({ unlockAt: e.target.value })} />
          <TextField label="Due" type="datetime-local" value={f.dueAt} onChange={(e) => set({ dueAt: e.target.value })} />
          <TextField label="Available until" type="datetime-local" value={f.lockAt} onChange={(e) => set({ lockAt: e.target.value })} hint="Open attempts are submitted at this time." />
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Results shown to students</legend>
          <SelectField label="Let students see their responses" value={f.hideResults} onChange={(e) => set({ hideResults: e.target.value as Quiz["hideResults"] })}>
            <option value="never">After each attempt</option>
            <option value="until_after_last_attempt">Only after their last attempt</option>
            <option value="always">Never</option>
          </SelectField>
          <Checkbox label="Show correct answers" checked={f.showCorrectAnswers} disabled={f.hideResults === "always"} onChange={(e) => set({ showCorrectAnswers: e.target.checked })} />
          {f.showCorrectAnswers && f.hideResults !== "always" && <TextField label="Show correct answers from" type="datetime-local" value={f.showCorrectAnswersAt} onChange={(e) => set({ showCorrectAnswersAt: e.target.value })} hint="Leave empty to show them right after submission." />}
          <Checkbox label="Shuffle answer choices" checked={f.shuffleAnswers} onChange={(e) => set({ shuffleAnswers: e.target.checked })} />
          {quiz.assignmentId && <Checkbox label="Release scores manually" hint="Scores and results stay hidden until you release grades." checked={f.postManually} onChange={(e) => set({ postManually: e.target.checked })} />}
        </fieldset>
        {quiz.assignmentId && (
          <SelectField label="Assignment group" value={f.groupId} onChange={(e) => set({ groupId: e.target.value })}>
            <option value="">Keep current</option>
            {groups.data?.data.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectField>
        )}
      </Card>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" className="text-red-700" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Delete quiz</Button>
        <Button type="submit" loading={busy}>Save settings</Button>
      </div>
    </form>
  );
}

function QuestionsEditor({ quiz }: { quiz: Quiz }) {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: QuizQuestion[] }>(`/quizzes/${quiz.id}/questions`);
  const [editing, setEditing] = useState<QuizQuestion | "new" | null>(null);
  const refresh = () => invalidate(`/quizzes/${quiz.id}`, `/courses/${quiz.courseId}`);
  const regrade = async () => {
    try {
      const r = await api.post<{ regraded: number }>(`/quizzes/${quiz.id}/regrade`);
      await refresh();
      fb.success(`Regraded ${r.regraded} attempt(s) with the current answer key.`);
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <Loadable query={q}>
      {(d) => (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            {(quiz.submittedAttempts ?? 0) > 0 || quiz.published ? (
              <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void regrade()}>Regrade submitted attempts</Button>
            ) : null}
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Question</Button>
          </div>
          {d.data.length === 0 && <Card><EmptyState icon={<FileQuestion className="size-6" />} title="No questions yet" description="Add at least one question before publishing." /></Card>}
          {d.data.map((question, i) => (
            <Card key={question.id} className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold">Question {i + 1}</span>
                <Badge>{TYPE_LABEL[question.type]}</Badge>
                <Badge tone="brand">{formatPoints(question.points)} pts</Badge>
                <div className="ml-auto flex">
                  <IconButton label={`Edit question ${i + 1}`} onClick={() => setEditing(question)}><Pencil className="size-4" /></IconButton>
                  <IconButton
                    label={`Delete question ${i + 1}`}
                    onClick={async () => {
                      if (!(await fb.confirm({ title: "Delete question?", message: "Existing attempts keep their answers; use Regrade to recalculate scores.", confirmLabel: "Delete", danger: true }))) return;
                      try {
                        await api.del(`/quiz-questions/${question.id}`);
                        await refresh();
                      } catch (err) {
                        fb.error(err);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>
              <RichContent html={question.promptHtml} />
              <AnswerKeySummary question={question} />
            </Card>
          ))}
          {editing && <QuestionDialog quizId={quiz.id} question={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
        </div>
      )}
    </Loadable>
  );
}

function AnswerKeySummary({ question }: { question: QuizQuestion }) {
  const key = question.answerKey;
  if (key.kind === "choice")
    return (
      <ul className="mt-3 space-y-1 text-sm">
        {question.choices.map((c) => (
          <li key={c.id} className={clsx("flex items-center gap-2", key.correctChoiceIds.includes(c.id) ? "font-medium text-emerald-800" : "text-slate-600")}>
            {key.correctChoiceIds.includes(c.id) ? <CheckCircle2 className="size-4" role="img" aria-label="Correct" /> : <span className="size-4" />} {c.text}
          </li>
        ))}
      </ul>
    );
  if (key.kind === "boolean") return <p className="mt-3 text-sm text-emerald-800">Correct answer: <strong>{key.value ? "True" : "False"}</strong></p>;
  return <p className="mt-3 text-sm text-slate-600">{key.acceptedAnswers.length ? `Accepted answers: ${key.acceptedAnswers.join(", ")}` : "Graded manually by an instructor."}</p>;
}

function QuestionDialog({ quizId, question, onClose, onSaved }: { quizId: string; question: QuizQuestion | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [type, setType] = useState<QuizQuestion["type"]>(question?.type ?? "multiple_choice");
  const [prompt, setPrompt] = useState(question?.promptMd ?? "");
  const [points, setPoints] = useState(String(question?.points ?? 1));
  const [choices, setChoices] = useState<{ id?: string; text: string; correct: boolean }[]>(
    question && question.answerKey.kind === "choice" ? question.choices.map((c) => ({ id: c.id, text: c.text, correct: (question.answerKey as { correctChoiceIds: string[] }).correctChoiceIds.includes(c.id) })) : [{ text: "", correct: true }, { text: "", correct: false }],
  );
  const [correctBoolean, setCorrectBoolean] = useState(question?.answerKey.kind === "boolean" ? question.answerKey.value : true);
  const [accepted, setAccepted] = useState(question?.answerKey.kind === "text" ? question.answerKey.acceptedAnswers.join("\n") : "");
  const [feedback, setFeedback] = useState(question?.feedback ?? "");
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      type,
      prompt,
      points: Number(points),
      choices: choices.filter((c) => c.text.trim()).map((c) => ({ id: c.id, text: c.text })),
      correctChoiceIndexes: choices.filter((c) => c.text.trim()).flatMap((c, i) => (c.correct ? [i] : [])),
      correctBoolean,
      acceptedAnswers: accepted.split("\n").map((s) => s.trim()).filter(Boolean),
      feedback,
    };
    try {
      if (question) await api.patch(`/quiz-questions/${question.id}`, body);
      else await api.post(`/quizzes/${quizId}/questions`, body);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  const isChoice = type === "multiple_choice" || type === "multiple_select";
  return (
    <Dialog open onClose={onClose} size="lg" title={question ? "Edit question" : "New question"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="question-form">Save question</Button></>}>
      <form id="question-form" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Question type" value={type} onChange={(e) => setType(e.target.value as QuizQuestion["type"])}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <TextField label="Points" type="number" min={0} step="0.5" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>
        <MarkdownEditor label="Question" value={prompt} onChange={setPrompt} rows={4} required hint="Markdown supported." />
        {isChoice && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Answer choices — mark the correct {type === "multiple_choice" ? "answer" : "answers"}</legend>
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type={type === "multiple_choice" ? "radio" : "checkbox"}
                  name="correct-choice"
                  aria-label={`Choice ${i + 1} is correct`}
                  checked={c.correct}
                  onChange={(e) => setChoices((cs) => cs.map((x, j) => (type === "multiple_choice" ? { ...x, correct: j === i } : j === i ? { ...x, correct: e.target.checked } : x)))}
                  className="size-4 accent-brand-700"
                />
                <input aria-label={`Choice ${i + 1}`} value={c.text} onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" placeholder={`Choice ${i + 1}`} />
                <IconButton label={`Remove choice ${i + 1}`} disabled={choices.length <= 2} onClick={() => setChoices((cs) => cs.filter((_, j) => j !== i))}><XCircle className="size-4" /></IconButton>
              </div>
            ))}
            <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setChoices((cs) => [...cs, { text: "", correct: false }])}>Add choice</Button>
          </fieldset>
        )}
        {type === "true_false" && (
          <fieldset className="flex gap-6">
            <legend className="mb-2 text-sm font-medium">Correct answer</legend>
            {[true, false].map((v) => (
              <label key={String(v)} className="flex items-center gap-2 text-sm">
                <input type="radio" name="tf" checked={correctBoolean === v} onChange={() => setCorrectBoolean(v)} className="size-4 accent-brand-700" /> {v ? "True" : "False"}
              </label>
            ))}
          </fieldset>
        )}
        {type === "short_answer" && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Accepted answers (one per line)</span>
            <textarea rows={3} value={accepted} onChange={(e) => setAccepted(e.target.value)} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="block text-xs text-slate-500">Matching ignores case and extra spaces. Leave empty to grade every response manually.</span>
          </label>
        )}
        <TextField label="Feedback shown with the correct answer (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </form>
    </Dialog>
  );
}

function AttemptsList({ quiz }: { quiz: Quiz }) {
  const { base } = useCourse();
  const q = useApi<{ data: { id: string; userId: string; studentName: string; attemptNumber: number; status: string; startedAt: string; submittedAt: string | null; score: number | null; pointsPossible: number | null }[] }>(`/quizzes/${quiz.id}/attempts`);
  return (
    <Card>
      <Loadable query={q}>
        {(d) =>
          d.data.length === 0 ? (
            <EmptyState title="No attempts yet" />
          ) : (
            <Table>
              <thead><tr><th>Student</th><th>Attempt</th><th>Submitted</th><th>Status</th><th className="text-right">Score</th><th /></tr></thead>
              <tbody>
                {d.data.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.studentName}</td>
                    <td>#{a.attemptNumber}</td>
                    <td className="text-slate-600">{a.submittedAt ? formatDateTime(a.submittedAt) : "In progress"}</td>
                    <td>{a.status === "pending_review" ? <Badge tone="violet">Needs review</Badge> : a.status === "graded" ? <Badge tone="green">Graded</Badge> : <Badge tone="blue">In progress</Badge>}</td>
                    <td className="text-right">{a.score === null ? "—" : `${formatPoints(a.score)} / ${formatPoints(a.pointsPossible)}`}</td>
                    <td className="text-right">{a.submittedAt && <Link to={`${base}/quizzes/${quiz.id}/attempts/${a.id}`} className="text-sm font-medium text-brand-700 hover:underline">{a.status === "pending_review" ? "Grade" : "View"}</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </Loadable>
    </Card>
  );
}

// ====================================================================== taking a quiz
function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : null;
}

export function QuizTake() {
  const { quizId, attemptId } = useParams();
  const { base, course } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ attempt: Attempt; quiz: Quiz }>(`/quiz-attempts/${attemptId}`, { refetchOnWindowFocus: false });
  const [answers, setAnswers] = useState<Record<string, QuizResponse>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef<Record<string, QuizResponse>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const initialized = useRef(false);
  const remaining = useCountdown(q.data?.attempt.expiresAt ?? null);

  useEffect(() => {
    if (q.data && !initialized.current) {
      initialized.current = true;
      setAnswers(Object.fromEntries(q.data.attempt.questions.map((x) => [x.id, x.answer])));
    }
  }, [q.data]);

  const flush = async () => {
    const pending = dirty.current;
    if (!Object.keys(pending).length) return;
    dirty.current = {};
    try {
      const r = await api.put<{ savedAt: string }>(`/quiz-attempts/${attemptId}/answers`, { answers: pending });
      setSavedAt(r.savedAt);
      setSaveError(null);
    } catch (err) {
      dirty.current = { ...pending, ...dirty.current };
      setSaveError(err instanceof ApiError ? err.message : "Could not save. Retrying…");
      if (err instanceof ApiError && err.status === 409) navigate(`${base}/quizzes/${quizId}/attempts/${attemptId}`, { replace: true });
    }
  };

  const answer = (qid: string, value: QuizResponse) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
    dirty.current[qid] = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  };

  const submit = async (auto = false) => {
    if (submitting) return;
    if (!auto) {
      const unanswered = (q.data?.attempt.questions ?? []).filter((x) => answers[x.id] === null || answers[x.id] === undefined || answers[x.id] === "" || (Array.isArray(answers[x.id]) && (answers[x.id] as string[]).length === 0)).length;
      const ok = await fb.confirm({ title: "Submit quiz?", message: unanswered ? `You have ${unanswered} unanswered question(s). You can't change answers after submitting.` : "You can't change answers after submitting.", confirmLabel: "Submit" });
      if (!ok) return;
    }
    setSubmitting(true);
    clearTimeout(timer.current);
    try {
      await api.post(`/quiz-attempts/${attemptId}/submit`, { answers: { ...dirty.current } });
      dirty.current = {};
      // The results page reads the same attempt URL; drop the in-progress copy from the cache.
      await invalidate(`/quiz-attempts/${attemptId}`, `/quizzes/${quizId}`, `/courses/${course.id}`, "/dashboard");
      if (auto) fb.info("Time is up — your quiz was submitted automatically.");
      navigate(`${base}/quizzes/${quizId}/attempts/${attemptId}`, { replace: true });
    } catch (err) {
      fb.error(err);
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (remaining === 0 && q.data?.attempt.status === "in_progress") void submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0]);

  useEffect(() => {
    const beforeUnload = () => {
      if (Object.keys(dirty.current).length) void flush();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Loadable query={q}>
      {({ attempt, quiz }) => {
        if (attempt.status !== "in_progress") {
          return <EmptyState title="This attempt has been submitted" action={<Link className="font-medium text-brand-700 hover:underline" to={`${base}/quizzes/${quizId}/attempts/${attemptId}`}>View results</Link>} />;
        }
        const mins = remaining !== null ? Math.floor(remaining / 60000) : null;
        const secs = remaining !== null ? Math.floor((remaining % 60000) / 1000) : null;
        return (
          <div className="space-y-5">
            <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border lg:top-2">
              <h1 className="mr-auto text-lg font-semibold">{quiz.title} · attempt {attempt.attemptNumber}</h1>
              <span className="text-xs text-slate-500" aria-live="polite">{saveError ? <span className="text-red-700">{saveError}</span> : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "Answers save automatically"}</span>
              {remaining !== null && (
                <span role="timer" aria-live={remaining < 60000 ? "assertive" : "off"} className={clsx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-mono text-sm font-semibold", remaining < 60000 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-800")}>
                  <Clock className="size-4" aria-hidden /> {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
                </span>
              )}
              <Button onClick={() => void submit(false)} loading={submitting}>Submit quiz</Button>
            </div>
            {attempt.questions.map((question, i) => (
              <QuestionInput key={question.id} index={i} question={question} value={answers[question.id] ?? null} onChange={(v) => answer(question.id, v)} />
            ))}
            <div className="flex justify-end">
              <Button onClick={() => void submit(false)} loading={submitting}>Submit quiz</Button>
            </div>
          </div>
        );
      }}
    </Loadable>
  );
}

function QuestionInput({ question, index, value, onChange }: { question: AttemptQuestion; index: number; value: QuizResponse; onChange: (v: QuizResponse) => void }) {
  const name = `q-${question.id}`;
  return (
    <Card as="section" className="p-5">
      <fieldset>
        <legend className="mb-3 w-full">
          <span className="flex items-center justify-between text-sm font-semibold">
            <span>Question {index + 1}</span>
            <span className="text-xs font-normal text-slate-500">{formatPoints(question.points)} pts</span>
          </span>
          <RichContent html={question.promptHtml} className="mt-2 font-normal" />
        </legend>
        {question.type === "multiple_choice" && (
          <div className="space-y-2">
            {question.choices.map((c) => (
              <label key={c.id} className={clsx("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", value === c.id ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                <input type="radio" name={name} checked={value === c.id} onChange={() => onChange(c.id)} className="size-4 accent-brand-700" /> {c.text}
              </label>
            ))}
          </div>
        )}
        {question.type === "multiple_select" && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Select all that apply.</p>
            {question.choices.map((c) => {
              const arr = Array.isArray(value) ? value : [];
              const checked = arr.includes(c.id);
              return (
                <label key={c.id} className={clsx("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", checked ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                  <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked ? [...arr, c.id] : arr.filter((x) => x !== c.id))} className="size-4 accent-brand-700" /> {c.text}
                </label>
              );
            })}
          </div>
        )}
        {question.type === "true_false" && (
          <div className="flex gap-3">
            {[true, false].map((v) => (
              <label key={String(v)} className={clsx("flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm", value === v ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="size-4 accent-brand-700" /> {v ? "True" : "False"}
              </label>
            ))}
          </div>
        )}
        {question.type === "short_answer" && (
          <textarea aria-label={`Answer to question ${index + 1}`} rows={3} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none" />
        )}
      </fieldset>
    </Card>
  );
}

// ====================================================================== results / manual grading
export function AttemptView() {
  const { quizId, attemptId } = useParams();
  const { base, permissions, course } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const url = `/quiz-attempts/${attemptId}`;
  const q = useApi<{ attempt: Attempt; student: { id: string; name: string }; quiz: Quiz }>(url);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const grader = permissions.canGrade && q.data?.student.id !== undefined && q.data.attempt.results !== undefined;

  useEffect(() => {
    const r = q.data?.attempt.results;
    if (!r) return;
    setScores(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.manual !== null ? String(v.manual) : ""])));
    setComments(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.comment ?? ""])));
  }, [q.data?.attempt.results]);

  const saveGrades = async () => {
    setBusy(true);
    try {
      await api.put(`${url}/grade`, {
        scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v === "" ? null : Number(v)])),
        comments,
      });
      await invalidate(url, `/quizzes/${quizId}`, `/courses/${course.id}`, "/dashboard");
      fb.success("Attempt grades saved and synced to the gradebook.");
    } catch (err) {
      fb.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Loadable query={q}>
      {({ attempt, student, quiz }) => (
        <div className="space-y-5">
          <PageHeader
            eyebrow={<Link to={`${base}/quizzes/${quizId}`} className="hover:underline">← {quiz.title}</Link>}
            title={grader ? `${student.name} — attempt ${attempt.attemptNumber}` : `Attempt ${attempt.attemptNumber} results`}
            description={`Submitted ${formatDateTime(attempt.submittedAt)}`}
            actions={
              <>
                {attempt.status === "pending_review" && <Badge tone="blue">Awaiting review — score may change</Badge>}
                {attempt.score !== null ? (
                  <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-lg font-semibold text-emerald-900">{formatPoints(attempt.score)} / {formatPoints(attempt.pointsPossible)}</span>
                ) : (
                  attempt.status !== "pending_review" && <Badge tone="blue">Score not released yet</Badge>
                )}
              </>
            }
          />
          {!grader && !attempt.visibility.responsesVisible && <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">Your instructor has chosen not to show question-level results{attempt.visibility.scoreVisible ? "" : " or scores"} yet. Your answers are shown below.</p>}
          {attempt.questions.map((question, i) => {
            const r = attempt.results?.[question.id];
            return (
              <Card key={question.id} className={clsx("p-5", question.correct === true && "border-emerald-200", question.correct === false && "border-red-200")}>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  Question {i + 1}
                  {question.correct === true && <Badge tone="green"><CheckCircle2 className="size-3" /> Correct</Badge>}
                  {question.correct === false && !question.needsReview && <Badge tone="red"><XCircle className="size-3" /> Incorrect</Badge>}
                  {question.needsReview && <Badge tone="violet">Needs grading</Badge>}
                  <span className="ml-auto text-xs font-normal text-slate-500">{question.earned !== undefined && question.earned !== null ? `${formatPoints(question.earned)} / ` : ""}{formatPoints(question.points)} pts</span>
                </div>
                <RichContent html={question.promptHtml} />
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{grader ? "Student answer" : "Your answer"}</span>
                  <AnswerDisplay question={question} />
                </div>
                {question.answerKey && <div className="mt-2 text-sm text-emerald-800"><span className="font-medium">Correct answer: </span><KeyDisplay question={question} /></div>}
                {question.feedback && <p className="mt-1 text-sm text-slate-600">{question.feedback}</p>}
                {!grader && question.comment && <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm"><strong>Instructor:</strong> {question.comment}</p>}
                {grader && r && (
                  <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[10rem_1fr]">
                    <TextField label={`Points (auto: ${r.auto === null ? "—" : formatPoints(r.auto)})`} type="number" min={0} max={question.points} step="0.5" placeholder="Use automatic" value={scores[question.id] ?? ""} onChange={(e) => setScores((s) => ({ ...s, [question.id]: e.target.value }))} />
                    <TextField label="Comment" value={comments[question.id] ?? ""} onChange={(e) => setComments((c) => ({ ...c, [question.id]: e.target.value }))} />
                  </div>
                )}
              </Card>
            );
          })}
          {grader && (
            <div className="flex justify-end">
              <Button onClick={() => void saveGrades()} loading={busy}>Save grades</Button>
            </div>
          )}
        </div>
      )}
    </Loadable>
  );
}

function AnswerDisplay({ question }: { question: AttemptQuestion }) {
  const a = question.answer;
  if (a === null || a === undefined || a === "" || (Array.isArray(a) && a.length === 0)) return <p className="italic text-slate-500">No answer</p>;
  if (question.type === "true_false") return <p>{a ? "True" : "False"}</p>;
  if (question.type === "short_answer") return <p className="whitespace-pre-wrap">{String(a)}</p>;
  const ids = Array.isArray(a) ? a : [a as string];
  return <p>{question.choices.filter((c) => ids.includes(c.id)).map((c) => c.text).join(", ")}</p>;
}

function KeyDisplay({ question }: { question: AttemptQuestion }) {
  const k = question.answerKey!;
  if (k.kind === "boolean") return <>{k.value ? "True" : "False"}</>;
  if (k.kind === "text") return <>{k.acceptedAnswers.length ? k.acceptedAnswers.join(" / ") : "Graded by instructor"}</>;
  return <>{question.choices.filter((c) => k.correctChoiceIds.includes(c.id)).map((c) => c.text).join(", ")}</>;
}
