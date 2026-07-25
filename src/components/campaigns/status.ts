export const CAMPAIGN_STATUS_BADGE: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  active: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning",
};

export const ENROLLMENT_STATUSES = [
  "active",
  "completed",
  "replied",
  "bounced",
  "ooo_paused",
  "failed",
  "unsubscribed",
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_STATUS_BADGE: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  completed: "bg-secondary text-secondary-foreground",
  replied: "bg-success/10 text-success",
  bounced: "bg-destructive/10 text-destructive",
  ooo_paused: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  unsubscribed: "bg-secondary text-secondary-foreground",
};

export const enrollmentStatusLabel = (s: string) => s.replace("_", " ");
