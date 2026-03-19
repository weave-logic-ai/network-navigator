"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Target,
  Plus,
  Sparkles,
  Check,
  Clock,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Play,
  X,
} from "lucide-react";

// ── Types ──

interface Goal {
  id: string;
  title: string;
  description: string | null;
  goal_type: string;
  status: string;
  priority: number;
  deadline: string | null;
  task_count: number;
  completed_task_count: number;
  created_at: string;
}

interface Task {
  id: string;
  goal_id: string | null;
  contact_id: string | null;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  priority: number;
  due_date: string | null;
  contact_name: string | null;
  created_at: string;
}

type TaskType = "manual" | "enrichment" | "scoring" | "outreach" | "expand_network";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  skipped: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
  active: "bg-blue-100 text-blue-700",
  paused: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-red-100 text-red-700",
};

const TASK_TYPES: TaskType[] = ["manual", "enrichment", "scoring", "outreach", "expand_network"];

// ── TaskItem component ──

function TaskItem({
  task,
  onStatusChange,
  onDelete,
}: {
  task: Task;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const nextStatus =
    task.status === "pending"
      ? "in_progress"
      : task.status === "in_progress"
        ? "completed"
        : null;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {task.description && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-medium truncate ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}
            >
              {task.title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {task.task_type}
              </Badge>
              <Badge className={`text-[10px] px-1.5 py-0 border-0 ${STATUS_COLORS[task.status] ?? ""}`}>
                {task.status.replace("_", " ")}
              </Badge>
              {task.contact_name && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                  <ExternalLink className="h-3 w-3" />
                  {task.contact_name}
                </span>
              )}
              {task.due_date && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {new Date(task.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {nextStatus && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onStatusChange(task.id, nextStatus)}
              title={nextStatus === "in_progress" ? "Start" : "Complete"}
            >
              {nextStatus === "in_progress" ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(task.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {expanded && task.description && (
        <p className="text-xs text-muted-foreground pl-6">{task.description}</p>
      )}
    </div>
  );
}

// ── InlineTaskForm ──

function InlineTaskForm({
  goalId,
  onSave,
  onCancel,
}: {
  goalId: string | null;
  onSave: (data: { title: string; description: string; taskType: string; priority: number; goalId: string | null }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<string>("manual");
  const [priority, setPriority] = useState(5);

  function handleSubmit() {
    if (!title.trim()) return;
    onSave({ title: title.trim(), description, taskType, priority, goalId });
  }

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2">
      <Input
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <Textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <div className="flex items-center gap-2">
        <Select value={taskType} onValueChange={setTaskType}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1}
          max={10}
          value={priority}
          onChange={(e) => setPriority(parseInt(e.target.value, 10) || 5)}
          className="h-8 w-20 text-xs"
          placeholder="Priority"
        />
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!title.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ── GoalCard component ──

function GoalCard({
  goal,
  tasks,
  onStatusChange,
  onDeleteGoal,
  onTaskStatusChange,
  onDeleteTask,
  onAddTask,
}: {
  goal: Goal;
  tasks: Task[];
  onStatusChange: (id: string, status: string) => void;
  onDeleteGoal: (id: string) => void;
  onTaskStatusChange: (id: string, status: string) => void;
  onDeleteTask: (id: string) => void;
  onAddTask: (data: { title: string; description: string; taskType: string; priority: number; goalId: string | null }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);

  const progress =
    goal.task_count > 0
      ? Math.round((goal.completed_task_count / goal.task_count) * 100)
      : 0;

  const nextStatus =
    goal.status === "active"
      ? "completed"
      : goal.status === "paused"
        ? "active"
        : goal.status === "completed"
          ? "active"
          : null;

  const nextLabel =
    goal.status === "active"
      ? "Complete"
      : goal.status === "paused"
        ? "Resume"
        : goal.status === "completed"
          ? "Reopen"
          : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{goal.title}</CardTitle>
              {goal.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {goal.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge className={`text-[10px] px-1.5 py-0 border-0 ${STATUS_COLORS[goal.status] ?? ""}`}>
              {goal.status}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              P{goal.priority}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Progress value={progress} className="flex-1 h-1.5" />
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {goal.completed_task_count}/{goal.task_count} tasks
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {nextStatus && nextLabel && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onStatusChange(goal.id, nextStatus)}
            >
              {nextStatus === "completed" ? (
                <Check className="h-3 w-3 mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {nextLabel}
            </Button>
          )}
          {goal.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onStatusChange(goal.id, "paused")}
            >
              Pause
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setExpanded(true);
              setShowTaskForm(true);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Task
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDeleteGoal(goal.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {expanded && (
          <div className="space-y-2 pt-1">
            {showTaskForm && (
              <InlineTaskForm
                goalId={goal.id}
                onSave={(data) => {
                  onAddTask(data);
                  setShowTaskForm(false);
                }}
                onCancel={() => setShowTaskForm(false)}
              />
            )}
            {tasks.length === 0 && !showTaskForm && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No tasks yet
              </p>
            )}
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onStatusChange={onTaskStatusChange}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──

export default function GoalsTasksPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalTasks, setGoalTasks] = useState<Record<string, Task[]>>({});
  const [standaloneTasks, setStandaloneTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showStandaloneForm, setShowStandaloneForm] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc] = useState("");
  const [newGoalPriority, setNewGoalPriority] = useState(5);

  const loadGoals = useCallback(async () => {
    try {
      const res = await fetch("/api/goals");
      if (res.ok) {
        const json = await res.json();
        setGoals(json.data ?? []);
      }
    } catch {
      // silent
    }
  }, []);

  const loadGoalTasks = useCallback(async (goalId: string) => {
    try {
      const res = await fetch(`/api/tasks?goalId=${goalId}`);
      if (res.ok) {
        const json = await res.json();
        setGoalTasks((prev) => ({ ...prev, [goalId]: json.data ?? [] }));
      }
    } catch {
      // silent
    }
  }, []);

  const loadStandaloneTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?goalId=null");
      if (res.ok) {
        const json = await res.json();
        setStandaloneTasks(json.data ?? []);
      }
    } catch {
      // silent
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadGoals(), loadStandaloneTasks()]);
    setLoading(false);
  }, [loadGoals, loadStandaloneTasks]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Load tasks for each goal after goals load
  useEffect(() => {
    goals.forEach((g) => {
      if (!goalTasks[g.id]) loadGoalTasks(g.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals]);

  // ── Actions ──

  async function createGoal() {
    if (!newGoalTitle.trim()) return;
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newGoalTitle.trim(),
          description: newGoalDesc || undefined,
          priority: newGoalPriority,
        }),
      });
      if (res.ok) {
        setNewGoalTitle("");
        setNewGoalDesc("");
        setNewGoalPriority(5);
        setShowGoalForm(false);
        await loadGoals();
      }
    } catch {
      // silent
    }
  }

  async function updateGoalStatus(id: string, status: string) {
    try {
      await fetch(`/api/goals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await loadGoals();
    } catch {
      // silent
    }
  }

  async function handleDeleteGoal(id: string) {
    try {
      await fetch(`/api/goals/${id}`, { method: "DELETE" });
      await loadGoals();
    } catch {
      // silent
    }
  }

  async function createTask(data: {
    title: string;
    description: string;
    taskType: string;
    priority: number;
    goalId: string | null;
  }) {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          description: data.description || undefined,
          taskType: data.taskType,
          priority: data.priority,
          goalId: data.goalId || undefined,
        }),
      });
      if (res.ok) {
        if (data.goalId) {
          await Promise.all([loadGoals(), loadGoalTasks(data.goalId)]);
        } else {
          await loadStandaloneTasks();
        }
      }
    } catch {
      // silent
    }
  }

  async function updateTaskStatus(id: string, status: string) {
    try {
      await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await Promise.all([loadGoals(), loadStandaloneTasks()]);
      goals.forEach((g) => loadGoalTasks(g.id));
    } catch {
      // silent
    }
  }

  async function handleDeleteTask(id: string) {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      await Promise.all([loadGoals(), loadStandaloneTasks()]);
      goals.forEach((g) => loadGoalTasks(g.id));
    } catch {
      // silent
    }
  }

  function handleGenerateGoals() {
    alert("Goal suggestions from Claude are not available yet. This feature will call POST /api/claude/suggestions when the API is ready.");
  }

  // ── Filter ──

  const filteredGoals =
    statusFilter === "all"
      ? goals
      : goals.filter((g) => g.status === statusFilter);

  const filteredStandalone =
    statusFilter === "all"
      ? standaloneTasks
      : standaloneTasks.filter((t) => t.status === statusFilter);

  // ── Render ──

  if (loading) {
    return (
      <div>
        <PageHeader title="Goals & Tasks" />
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Goals & Tasks"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
            >
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateGoals}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Generate
            </Button>
            <Button size="sm" onClick={() => setShowGoalForm(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Goal
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Left column: Goals */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Goals</h2>
            <Badge variant="secondary" className="text-[10px]">
              {filteredGoals.length}
            </Badge>
          </div>

          {showGoalForm && (
            <Card className="border-dashed">
              <CardContent className="p-4 space-y-2">
                <Input
                  placeholder="Goal title"
                  value={newGoalTitle}
                  onChange={(e) => setNewGoalTitle(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createGoal();
                    if (e.key === "Escape") setShowGoalForm(false);
                  }}
                />
                <Textarea
                  placeholder="Description (optional)"
                  value={newGoalDesc}
                  onChange={(e) => setNewGoalDesc(e.target.value)}
                  rows={2}
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={newGoalPriority}
                    onChange={(e) =>
                      setNewGoalPriority(parseInt(e.target.value, 10) || 5)
                    }
                    className="h-8 w-24 text-xs"
                    placeholder="Priority"
                  />
                  <span className="text-xs text-muted-foreground">Priority (1-10)</span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowGoalForm(false)}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={createGoal}
                    disabled={!newGoalTitle.trim()}
                  >
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {filteredGoals.length === 0 && !showGoalForm && (
            <Card>
              <CardContent className="p-8 text-center">
                <Target className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No goals yet. Create one or let Claude suggest goals based on your network.
                </p>
              </CardContent>
            </Card>
          )}

          {filteredGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              tasks={goalTasks[goal.id] ?? []}
              onStatusChange={updateGoalStatus}
              onDeleteGoal={handleDeleteGoal}
              onTaskStatusChange={updateTaskStatus}
              onDeleteTask={handleDeleteTask}
              onAddTask={createTask}
            />
          ))}
        </div>

        {/* Right column: Standalone Tasks */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Standalone Tasks</h2>
              <Badge variant="secondary" className="text-[10px]">
                {filteredStandalone.length}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowStandaloneForm(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>

          {showStandaloneForm && (
            <InlineTaskForm
              goalId={null}
              onSave={(data) => {
                createTask(data);
                setShowStandaloneForm(false);
              }}
              onCancel={() => setShowStandaloneForm(false)}
            />
          )}

          {filteredStandalone.length === 0 && !showStandaloneForm && (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-xs text-muted-foreground">
                  No standalone tasks. Tasks not assigned to a goal appear here.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            {filteredStandalone.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onStatusChange={updateTaskStatus}
                onDelete={handleDeleteTask}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
