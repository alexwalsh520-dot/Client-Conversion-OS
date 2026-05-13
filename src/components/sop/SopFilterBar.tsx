"use client";

/**
 * Filter bar for the SOP library: search box + department dropdown + role
 * dropdown (filtered to the selected department) + Upload button (admins).
 */

import { Search, Plus, BookOpen } from "lucide-react";
import type { SopDepartment, SopRole, SopPermissions } from "@/lib/sop/types";

interface Props {
  departments: SopDepartment[];
  roles: SopRole[];
  search: string;
  selectedDepartmentId: number | null;
  selectedRoleId: number | null;
  onSearchChange: (s: string) => void;
  onDepartmentChange: (id: number | null) => void;
  onRoleChange: (id: number | null) => void;
  onUploadClick: () => void;
  onManageTaxonomyClick: () => void;
  permissions: SopPermissions;
  totalCount: number;
}

export default function SopFilterBar({
  departments,
  roles,
  search,
  selectedDepartmentId,
  selectedRoleId,
  onSearchChange,
  onDepartmentChange,
  onRoleChange,
  onUploadClick,
  onManageTaxonomyClick,
  permissions,
  totalCount,
}: Props) {
  // Roles dropdown is filtered to the selected department, OR shows all if
  // no department selected (so the user can browse roles across depts).
  const visibleRoles = selectedDepartmentId
    ? roles.filter((r) => r.department_id === selectedDepartmentId)
    : roles;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        marginBottom: 16,
      }}
    >
      {/* Search */}
      <div style={{ position: "relative", flex: "1 1 280px", minWidth: 0 }}>
        <Search
          size={14}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          className="input-field"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search SOPs by title or description..."
          style={{ paddingLeft: 36, width: "100%" }}
        />
      </div>

      {/* Department filter */}
      <select
        className="input-field"
        value={selectedDepartmentId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onDepartmentChange(v ? parseInt(v, 10) : null);
          onRoleChange(null); // reset role when dept changes
        }}
        style={{ width: "auto", minWidth: 160 }}
      >
        <option value="">All Departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>

      {/* Role filter */}
      <select
        className="input-field"
        value={selectedRoleId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onRoleChange(v ? parseInt(v, 10) : null);
        }}
        disabled={visibleRoles.length === 0}
        style={{ width: "auto", minWidth: 160, opacity: visibleRoles.length === 0 ? 0.5 : 1 }}
        title={
          visibleRoles.length === 0
            ? selectedDepartmentId
              ? "No roles defined for this department yet"
              : "No roles defined yet"
            : undefined
        }
      >
        <option value="">All Roles</option>
        {visibleRoles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>

      {/* Total count, shown when not all default */}
      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto", whiteSpace: "nowrap" }}>
        {totalCount} {totalCount === 1 ? "SOP" : "SOPs"}
      </span>

      {/* Admin actions */}
      {permissions.canManage && (
        <button
          className="btn-secondary"
          onClick={onManageTaxonomyClick}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px" }}
          title="Manage departments and roles"
        >
          <BookOpen size={13} /> Taxonomy
        </button>
      )}
      {permissions.canUpload && (
        <button
          className="btn-primary"
          onClick={onUploadClick}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={14} /> Upload SOP
        </button>
      )}
    </div>
  );
}
