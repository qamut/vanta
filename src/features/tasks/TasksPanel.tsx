import { AnimatePresence, motion } from "motion/react";
import { Bell, CalendarClock, Check, ListChecks, Pencil, Plus, Trash2 } from "../../components/icons";
import { useMemo, useState, type FormEvent } from "react";
import { Button, Empty, IconButton, Ring, Segmented, useNow } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { fromLocalInput, toLocalInput } from "../../lib/time";
import { keyboardProps } from "../island/focus";
import { patchSettings, useSettings } from "../settings/store";
import { filterTasks, isOverdue, sortTasks, todayProgress, type Priority, type Task, type TaskFilter, type TaskSort } from "./model";
import { taskActions, useTasks } from "./store";

function dueLabel(ts: number, now: number, locale: string): string {
  const d = new Date(ts);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(locale, { day: "2-digit", month: "short" })} ${time}`;
}

function Editor(props: { task?: Task; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(props.task?.title ?? "");
  const [priority, setPriority] = useState<Priority>(props.task?.priority ?? "medium");
  const [due, setDue] = useState(toLocalInput(props.task?.due));
  const [remind, setRemind] = useState(toLocalInput(props.task?.remindAt));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch = { title, priority, due: fromLocalInput(due), remindAt: fromLocalInput(remind) };
    if (props.task) taskActions.update(props.task.id, patch);
    else if (!taskActions.add(title, patch)) return;
    props.onDone();
  };
  return (
    <motion.form className="vt-task-editor" onSubmit={submit} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
      <input className="vt-input" autoFocus value={title} maxLength={200} placeholder={t("tasks.titlePlaceholder")} aria-label={t("tasks.title")} onChange={(e) => setTitle(e.target.value)} {...keyboardProps} />
      <div className="vt-task-editor__row">
        <Segmented<Priority>
          size="sm"
          label={t("tasks.priority")}
          value={priority}
          onChange={setPriority}
          options={[
            { value: "low", label: t("tasks.priority.low") },
            { value: "medium", label: t("tasks.priority.medium") },
            { value: "high", label: t("tasks.priority.high") },
          ]}
        />
        <label className="vt-field-inline">
          <CalendarClock size={13} aria-hidden />
          <span className="sr-only">{t("tasks.due")}</span>
          <input type="datetime-local" className="vt-input is-sm" value={due} onChange={(e) => setDue(e.target.value)} {...keyboardProps} title={t("tasks.due")} />
        </label>
        <label className="vt-field-inline">
          <Bell size={13} aria-hidden />
          <span className="sr-only">{t("tasks.remind")}</span>
          <input type="datetime-local" className="vt-input is-sm" value={remind} onChange={(e) => setRemind(e.target.value)} {...keyboardProps} title={t("tasks.remind")} />
        </label>
        <span className="vt-task-editor__btns">
          <Button size="sm" variant="ghost" onClick={props.onDone}>{t("common.cancel")}</Button>
          <Button size="sm" variant="accent" type="submit" disabled={!title.trim()}>{props.task ? t("common.save") : t("tasks.add")}</Button>
        </span>
      </div>
    </motion.form>
  );
}

function Row(props: { task: Task; now: number; locale: string; editing: boolean; onEdit: () => void; onCloseEdit: () => void }) {
  const t = useT();
  const { task } = props;
  const [confirm, setConfirm] = useState(false);
  const overdue = isOverdue(task, props.now);
  if (props.editing) return <li className="vt-task is-editing"><Editor task={task} onDone={props.onCloseEdit} /></li>;
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className={`vt-task ${task.done ? "is-done" : ""}`}>
      <button
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? t("tasks.reopen", { title: task.title }) : t("tasks.complete", { title: task.title })}
        className={`vt-check vt-check--${task.priority}`}
        onClick={() => taskActions.toggle(task.id)}
      >
        <AnimatePresence>
          {task.done && (
            <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: "spring", visualDuration: 0.3, bounce: 0.5 }}>
              <Check size={12} strokeWidth={3} aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <span className="vt-task__body" onDoubleClick={props.onEdit}>
        <span className="vt-task__title">{task.title}</span>
        {(task.due || task.remindAt) && (
          <span className="vt-task__meta">
            {task.due && (
              <span className={overdue ? "is-overdue" : ""}>
                <CalendarClock size={11} aria-hidden /> {overdue ? t("tasks.overdue") + " · " : ""}
                {dueLabel(task.due, props.now, props.locale)}
              </span>
            )}
            {task.remindAt && !task.done && (
              <span>
                <Bell size={11} aria-hidden /> {dueLabel(task.remindAt, props.now, props.locale)}
              </span>
            )}
          </span>
        )}
      </span>
      {confirm ? (
        <span className="vt-task__confirm" role="group" aria-label={t("tasks.deleteConfirm")}>
          <span>{t("tasks.deleteConfirm")}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t("common.no")}</Button>
          <Button size="sm" variant="danger" onClick={() => taskActions.remove(task.id)}>{t("common.yes")}</Button>
        </span>
      ) : (
        <span className="vt-task__actions">
          <IconButton icon={Pencil} size="sm" label={t("tasks.edit")} onClick={props.onEdit} />
          <IconButton icon={Trash2} size="sm" variant="danger" label={t("tasks.delete")} onClick={() => setConfirm(true)} />
        </span>
      )}
    </motion.li>
  );
}

export function TasksPanel() {
  const t = useT();
  const tasks = useTasks((s) => s.value.tasks);
  const prefs = useSettings((s) => s.value.tasks);
  const locale = useSettings((s) => s.value.general.language);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [editing, setEditing] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const progress = todayProgress(tasks, now);
  const list = useMemo(() => sortTasks(filterTasks(tasks, filter), prefs.sort), [tasks, filter, prefs.sort]);

  const addQuick = (e: FormEvent) => {
    e.preventDefault();
    if (taskActions.add(quick)) setQuick("");
  };

  return (
    <div className="vt-tasks">
      <div className="vt-tasks__summary">
        <Ring value={progress.total ? progress.done / progress.total : 0} size={40} stroke={4} color="var(--success)">
          <ListChecks size={15} aria-hidden />
        </Ring>
        <div className="vt-tasks__count">
          <strong className="tabular">
            {progress.done}/{progress.total}
          </strong>
          <span>{t("tasks.doneToday")}</span>
        </div>
        <Segmented<TaskFilter>
          size="sm"
          label={t("tasks.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t("tasks.filter.open") },
            { value: "done", label: t("tasks.filter.done") },
            { value: "all", label: t("tasks.filter.all") },
          ]}
        />
        <select
          className="vt-input is-sm"
          aria-label={t("tasks.sort")}
          value={prefs.sort}
          onChange={(e) => patchSettings("tasks", { sort: e.target.value as TaskSort })}
          {...keyboardProps}
        >
          <option value="priority">{t("tasks.sort.priority")}</option>
          <option value="due">{t("tasks.sort.due")}</option>
          <option value="created">{t("tasks.sort.created")}</option>
        </select>
      </div>
      <form className="vt-tasks__quick" onSubmit={addQuick}>
        <input
          className="vt-input"
          value={quick}
          maxLength={200}
          placeholder={t("tasks.quickPlaceholder")}
          aria-label={t("tasks.quickPlaceholder")}
          onChange={(e) => setQuick(e.target.value)}
          {...keyboardProps}
        />
        <IconButton icon={Plus} label={t("tasks.add")} variant="accent" disabled={!quick.trim()} onClick={() => taskActions.add(quick) && setQuick("")} />
        <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>{t("tasks.details")}</Button>
      </form>
      <AnimatePresence>{editing === "new" && <Editor key="new" onDone={() => setEditing(null)} />}</AnimatePresence>
      {list.length === 0 ? (
        <Empty icon={ListChecks} title={filter === "done" ? t("tasks.emptyDone") : t("tasks.empty")} body={filter === "open" ? t("tasks.emptyBody") : undefined} />
      ) : (
        <ul className="vt-tasks__list" aria-label={t("tasks.listLabel")}>
          <AnimatePresence initial={false}>
            {list.map((task) => (
              <Row key={task.id} task={task} now={now} locale={locale} editing={editing === task.id} onEdit={() => setEditing(task.id)} onCloseEdit={() => setEditing(null)} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
