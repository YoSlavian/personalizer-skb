export type Role = "admin" | "analyst" | "manager" | "client";

export interface UserBrief {
  id: number;
  full_name: string;
  role: Role;
}

export interface Me {
  user: {
    id: number;
    email: string;
    full_name: string;
    role: Role;
    settings: Record<"notify_telegram" | "notify_applications" | "notify_tasks" | "notify_offers" | "adaptive_hints", boolean>;
    telegram: { id: number; username: string | null; linked_at: string; via: string }[];
  };
  organizations: { id: number; contact_id: number }[];
  csrf_token: string | null;
  demo_mode: boolean;
  /** Публичное демо (прод + DEMO_MODE): часть действий доступна только в режиме предпросмотра */
  public_demo?: boolean;
  bot_username: string | null;
  token?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface OrgBrief {
  id: number;
  name: string;
  industry: string;
  industry_name: string;
}

export type AppStatus = "draft" | "submitted" | "in_review" | "needs_info" | "approved" | "declined" | "cancelled";

export interface Application {
  id: number;
  number: string;
  organization: OrgBrief;
  product_code: string;
  product_name: string;
  amount_rub: number;
  term_months: number;
  comment: string | null;
  status: AppStatus;
  status_name: string;
  source: string;
  author: UserBrief | null;
  assignee: UserBrief | null;
  communication_id: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  decided_at: string | null;
}

export interface Change {
  id: number;
  from_status: string | null;
  to_status: string;
  from_name: string | null;
  to_name: string;
  actor: UserBrief | null;
  comment: string | null;
  created_at: string;
}

export interface Comment {
  id: number;
  body: string;
  internal: boolean;
  author: UserBrief | null;
  created_at: string;
}

export interface ApplicationDetail extends Application {
  history: Change[];
  comments: Comment[];
}

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export interface Task {
  id: number;
  organization: OrgBrief;
  kind: string;
  kind_name: string;
  title: string;
  description: string;
  priority: "low" | "normal" | "high";
  status: TaskStatus;
  status_name: string;
  source: string;
  assignee: UserBrief | null;
  due_at: string | null;
  overdue: boolean;
  application_id: number | null;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TaskDetail extends Task {
  history: Change[];
}

export interface Notification {
  id: number;
  kind: "application" | "task" | "offer" | "system";
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
  telegram: string;
}

export interface VisualData {
  type: string;
  big?: string;
  small?: string;
  note?: string;
  months?: number[];
  peak_index?: number;
  entities?: { share: number; balance: "credit" | "surplus" }[];
}

export interface Placement {
  communication_id: number;
  channel: string;
  product_code: string;
  product_name: string;
  headline: string;
  body: string;
  cta: string;
  visual: string;
  visual_data: VisualData;
  why: string;
  calculable: boolean;
}

export interface CabinetHome {
  organization: { id: number; name: string; industry: string; industry_name: string; group: string | null; manager: string | null };
  role: { code: string | null; name: string; source: "crm" | "inferred" | "none" };
  variant: "test" | "control";
  offer: Placement | null;
  suppressed: boolean;
  routing: string | null;
  drafts: Application[];
  applications: Application[];
  consents: { email: boolean; push: boolean; all: boolean };
  synthetic_balance: string;
}

export interface ScoreRow {
  code: string;
  name: string;
  base: number;
  k_industry: number;
  k_moment: number;
  k_role: number;
  k_structure: number;
  k_source: number;
  total: number;
  excluded_reason: string | null;
  why: string[];
}

export interface DecisionResult {
  company: string;
  completeness: number;
  fallback: boolean;
  suppressed: boolean;
  activity_level: "high" | "mid" | "low";
  role: string | null;
  role_name: string | null;
  winner: ScoreRow | null;
  offer: { product_code: string; product_name: string; headline: string; body: string; cta: string; visual: string } | null;
  recipient: string;
  channels: { code: string; label: string }[];
  frequency: string;
  nba: string;
  actions: { type: string; kind: string | null; title: string | null; priority: string; due_hours: number | null }[];
  routing: string | null;
  event_note: string | null;
  notes: string[];
  rows: ScoreRow[];
  as_is: { product_code: string; product_name: string; headline: string; who: string; channel: string; frequency: string; group: string };
  segments: string[];
  visual_data: VisualData;
}

export interface GroupEntity {
  name: string;
  industry: string;
  share: number;
  balance: "credit" | "surplus";
  org_id?: number | null;
  head?: boolean;
}

export interface Profile {
  company: string;
  industry: string;
  seasonal: boolean;
  weeks_to_peak: number;
  role: string;
  role_source: "crm" | "inferred" | "none";
  structure: "solo" | "group";
  size: "mid" | "large";
  group: { name: string; entities: GroupEntity[] } | null;
  mixed_balances: boolean;
  logins_30d: number;
  fx_payment: boolean;
  deposit_ending: boolean;
  bki_request: boolean;
  hidden_products: string[];
  stopped_products: string[];
  opt_out_email: boolean;
  opt_out_push: boolean;
  opt_out_all: boolean;
  turnover_by_month: number[] | null;
}

export interface OrgDecision {
  org_id: number;
  decision_org_id: number;
  group_level: boolean;
  variant: "test" | "control";
  rule_version: number;
  peak_month: number;
  role_inference: { role: string | null; source: string; explanation: string };
  profile: Profile;
  result: DecisionResult;
}

export interface Org {
  id: number;
  name: string;
  inn: string;
  industry: string;
  industry_name: string;
  revenue_mln: number;
  size: "mid" | "large";
  seasonal: boolean;
  logins_30d: number;
  activity_level: "high" | "mid" | "low";
  group: { id: number; name: string; ab_variant: string } | null;
  head_of_group: boolean;
  ab_variant: "test" | "control";
  manager: UserBrief | null;
  primary_role: string | null;
  primary_role_name: string;
  role_source: "crm" | "inferred" | "none";
  completeness: number;
  segments: string[];
  signals: { id: number; kind: string; name: string; note: string | null; expires_at: string }[];
  consents: { email: boolean; push: boolean; all: boolean };
  open_tasks: number;
}

export interface Contact {
  id: number;
  label: string;
  crm_position: string | null;
  ib_rights: string | null;
  boss_access: boolean;
  is_primary: boolean;
  user: UserBrief | null;
  role: string | null;
  role_name: string;
  role_source: string;
  role_explanation: string;
}

export interface OrgDetail extends Org {
  contacts: Contact[];
  group_members: { id: number; name: string; industry_name: string; head: boolean; balance_kind: string | null }[];
}

export interface JourneySession {
  id: number;
  product_code: string;
  adapt: boolean;
  variant: string;
  outcome: string;
  metrics: { elapsed_sec: number; time_to_apply_sec: number | null; steps: number; returns: number; recalcs: number; hints_shown: number; hints_closed: number };
  screen: string;
  log: string[];
  active: Adaptation[];
  new: Adaptation[];
  config?: { idle_seconds: number; returns_threshold: number; recalc_threshold: number; quick_seconds: number };
  draft_id?: number;
  task_id?: number;
  message?: string;
}

export type Adaptation = { type: "draft_resume" | "compare_block" | "quick_apply" | "hint_sheet"; variant?: "ask_manager" | "send_to_fd"; reason?: string };

export interface Showcase {
  variant: string;
  items: { code: string; name: string; recommended: boolean; calculable: boolean; why: string[] }[];
  offer_product: string | null;
}

export interface VariantStats {
  delivered: number;
  shown: number;
  clicked: number;
  converted: number;
  hidden: number;
  deals: number;
  ctr: number | null;
  cr: number | null;
  view_to_deal: number | null;
  time_to_action_hours: number | null;
  messages_per_group_week: number | null;
  opt_outs: number;
  organizations: number;
}

export interface Analytics {
  period_days: number;
  variants: { test: VariantStats; control: VariantStats };
  uplift: { ctr: number | null; cr: number | null };
  significance_cr: { z: number | null; p_value: number | null };
  segments: { code: string; name: string; test: VariantStats; control: VariantStats; uplift_cr: number | null }[];
  channels: ({ code: string; name: string } & VariantStats)[];
  weekly: { week: string; test_cr: number | null; control_cr: number | null; test_shown: number; control_shown: number }[];
  funnel: Record<"test" | "control", { shown: number; clicked: number; applications: number; approved: number }>;
  journey: Record<"adaptive" | "static", { sessions: number; applied: number; apply_rate: number | null; median_time_to_apply_sec: number | null; calc_sessions: number; dropoff_calc_to_form: number | null; hints_shown: number; hints_closed: number }>;
  blocked_by_policy: Record<string, number>;
  disclaimer: string;
}

export interface StaffDashboard {
  kpi: {
    open_tasks: number;
    overdue_tasks: number;
    open_applications: number;
    cr_test: number | null;
    cr_control: number | null;
    ctr_test: number | null;
    ctr_control: number | null;
    uplift_cr: number | null;
    opt_outs_30d: number;
    time_to_action_test: number | null;
    time_to_action_control: number | null;
  };
  tasks: Task[];
  applications: Application[];
  notifications: Notification[];
  weekly: Analytics["weekly"];
  disclaimer: string;
}

export interface CampaignStats {
  id?: number;
  units: number;
  decisions: number;
  variants: Record<string, number>;
  sent_by_channel: Record<string, number>;
  sent_total: number;
  blocked_by_reason: Record<string, number>;
  blocked_total: number;
  suppressed_opt_out: number;
  no_offer: number;
  tasks_created: number;
  examples: { org_id: number; company: string; product: string; recipient: string; channels: string[]; variant: string }[];
  dry_run: boolean;
  rule_version: number;
}

export interface Catalog {
  industries: { code: string; name: string; seasonal: boolean }[];
  roles: { code: string; name: string; lpr: boolean; focus: string }[];
  role_sources: { code: string; name: string }[];
  products: { code: string; name: string; category: string; lpr: boolean; group: boolean; large: boolean; visual: string; calculable: boolean }[];
  channels: { code: string; name: string }[];
  signals: { code: string; name: string }[];
  segments: { code: string; name: string }[];
}
