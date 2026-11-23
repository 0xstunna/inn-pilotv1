/**
 * Premium hospitality UI components shared across all screens.
 */
import { createElement, Fragment, isValidElement, type ElementType, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

export interface KPICardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: ElementType;
  tone?: "primary" | "success" | "warning" | "danger";
  delta?: number | null;
  loading?: boolean;
}

export function KPICard({ label, value, hint, icon: Icon, tone = "primary", delta, loading = false }: KPICardProps) {
  return (
    <div className={`kpi-card kpi-tone-${tone}`}>
      <div className="kpi-head">
        <div className="kpi-icon" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
          <Icon size={18} />
        </div>
        {loading ? (
          <div className="kpi-value" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <h3 className="kpi-value">{value}</h3>
        )}
      </div>
      <p className="kpi-label">{label}</p>
      {hint && <p className="kpi-hint">{hint}</p>}
      {delta !== null && delta !== undefined && (
        <p className={`kpi-delta ${delta >= 0 ? "is-good" : "is-bad"}`}>
          {Math.abs(delta)}% vs last period
        </p>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon: ReactNode | ElementType;
  title: string;
  description: string;
  action?: ReactNode;
  iconColor?: string;
}

export function EmptyState({ icon, title, description, action, iconColor = "var(--empty-icon)" }: EmptyStateProps) {
  const iconNode = isValidElement(icon) ? icon : createElement(icon as ElementType, { size: 28 });
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ color: iconColor }}>
        {iconNode}
      </div>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-desc">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}

export interface StatusChipProps {
  state: "connected" | "pending" | "disconnected";
  label: string;
}

export function StatusChip({ state, label }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${state}`}>
      <span className="dot" /> {label}
    </span>
  );
}

export interface StepItem {
  key: string;
  label: string;
}

export interface StepStepperProps {
  steps: StepItem[];
  activeKey: string;
  doneKeys: string[];
}

export function StepStepper({ steps, doneKeys }: StepStepperProps) {
  return (
    <div className="step-stepper">
      {steps.map((step, i) => (
        <Fragment key={step.key}>
          <div className="step">
            <div className={`step-number ${doneKeys.includes(step.key) ? "is-done" : ""}`}>
              {doneKeys.includes(step.key) ? (
                <Check size={14} strokeWidth={2.5} />
              ) : (
                i + 1
              )}
            </div>
            <span className={`step-label ${doneKeys.includes(step.key) ? "is-done" : ""}`}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && <div className={`step-line ${doneKeys.includes(step.key) ? "is-done" : ""}`} />}
        </Fragment>
      ))}
    </div>
  );
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number | null;
  state: "pending" | "active" | "complete";
}

export interface FunnelProps {
  stages: FunnelStage[];
}

export function Funnel({ stages }: FunnelProps) {
  return (
    <div className="funnel">
      {stages.map((stage, i) => (
        <Fragment key={stage.key}>
          <div className="funnel-stage">
            <div className={`funnel-badge ${stage.state === "active" ? "is-active" : stage.state === "complete" ? "is-complete" : ""}`}>
              {stage.state === "complete" ? <Check size={14} strokeWidth={2.5} /> : i + 1}
            </div>
            <span className={`funnel-label ${stage.state === "active" ? "is-active" : stage.state === "complete" ? "is-complete" : ""}`}>
              {stage.label}
            </span>
            {stage.value !== null && <span className="funnel-value">{stage.value}</span>}
          </div>
          {i < stages.length - 1 && <div className={`funnel-line ${stage.state === "complete" ? "is-complete" : stage.state === "active" ? "is-active" : ""}`} />}
        </Fragment>
      ))}
    </div>
  );
}

export interface ActionTileProps {
  title: string;
  description: string;
  icon: ReactNode | ElementType;
  to?: string;
  onClick?: () => void;
}

export function ActionTile({ title, description, icon, to, onClick }: ActionTileProps) {
  const iconNode = isValidElement(icon) ? icon : createElement(icon as ElementType, { size: 18 });
  const content = (
    <>
      <span className="action-tile-icon">{iconNode}</span>
      <h4 className="action-tile-title">{title}</h4>
      <p className="action-tile-desc">{description}</p>
    </>
  );
  if (to) {
    return <Link to={to} className="action-tile">{content}</Link>;
  }
  return (
    <button type="button" className="action-tile" onClick={onClick}>
      {content}
    </button>
  );
}

export interface PremiumTableProps {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  rowKey?: (row: Record<string, unknown>) => string;
  cellRenderer?: (key: string, value: unknown, row: Record<string, unknown>) => ReactNode;
  loading?: boolean;
}

export function PremiumTable({ columns, rows, rowKey, cellRenderer, loading = false }: PremiumTableProps) {
  if (loading) {
    return (
      <div className="premium-table">
        <tbody>
          {[...Array(3)].map((_, r) => (
            <tr key={r}>
              {columns.map((_, c) => (
                <td key={c}>
                  <div className="skeleton" style={{ height: 14, width: c === 0 ? 140 : 96 }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="premium-table">
        <tbody>
          <tr>
            <td colSpan={columns.length} style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--text-muted)" }}>
              No records found.
            </td>
          </tr>
        </tbody>
      </div>
    );
  }
  return (
    <table className="premium-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey ? rowKey(row) : String(row.id ?? i)}>
            {columns.map((col) => (
              <td key={col.key}>
                {cellRenderer ? cellRenderer(col.key, row[col.key], row) : String(row[col.key] ?? "—")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface SectionProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Section({ title, subtitle, action, children }: SectionProps) {
  return (
    <div className="section">
      {(title || action) && (
        <div className="section-head">
          <div className="section-title-wrap">
            {title && <h3 className="section-title">{title}</h3>}
            {subtitle && <p className="text-xs muted">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

export interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
}

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <div className="form-section">
      {title && <h3 className="form-section-title">{title}</h3>}
      {description && <p className="form-section-desc">{description}</p>}
      <div>{children}</div>
    </div>
  );
}

export function LoaderOverlay({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <div className="loader-overlay">
      <Loader2 size={32} className="animate-spin" style={{ color: "var(--primary)" }} />
    </div>
  );
}