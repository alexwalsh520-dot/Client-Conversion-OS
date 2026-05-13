"use client";

/**
 * SOP library — main page at /sop.
 *
 * Lists all SOPs as a card grid with search + department + role filters.
 * Admins also see Upload + Taxonomy buttons. Empty state is intentional
 * and polished because the library will be empty for a while.
 */

import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import type {
  SopDepartment,
  SopRole,
  SopWithRelations,
} from "@/lib/sop/types";
import SopCard from "@/components/sop/SopCard";
import SopFilterBar from "@/components/sop/SopFilterBar";
import SopEmptyState from "@/components/sop/SopEmptyState";
import SopUploadModal from "@/components/sop/SopUploadModal";
import SopTaxonomyModal from "@/components/sop/SopTaxonomyModal";

export default function SopLibraryPage() {
  const [departments, setDepartments] = useState<SopDepartment[]>([]);
  const [roles, setRoles] = useState<SopRole[]>([]);
  const [sops, setSops] = useState<SopWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);

  // Determine admin status from session. We hit a tiny endpoint to peek.
  // Could also be passed via getServerSession + props, but a client-side
  // probe keeps the page a single client component for now.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIsAdmin(data?.user?.role === "admin");
      } catch {
        // Default to non-admin; UI just hides the upload button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load taxonomy + initial SOPs in parallel
  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [deptRes, roleRes, sopRes] = await Promise.all([
        fetch("/api/sop/departments"),
        fetch("/api/sop/roles"),
        fetch(buildSopUrl(search, selectedDepartmentId, selectedRoleId)),
      ]);
      if (!deptRes.ok) throw new Error("Failed to load departments");
      if (!roleRes.ok) throw new Error("Failed to load roles");
      if (!sopRes.ok) throw new Error("Failed to load SOPs");
      const [deptData, roleData, sopData] = await Promise.all([
        deptRes.json(),
        roleRes.json(),
        sopRes.json(),
      ]);
      setDepartments(deptData.departments ?? []);
      setRoles(roleData.roles ?? []);
      setSops(sopData.sops ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch SOPs when filters change (debounced for search)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(buildSopUrl(search, selectedDepartmentId, selectedRoleId));
        if (!res.ok) return;
        const data = await res.json();
        setSops(data.sops ?? []);
      } catch {
        // silent
      }
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selectedDepartmentId, selectedRoleId]);

  const isFiltered = useMemo(
    () => Boolean(search.trim() || selectedDepartmentId || selectedRoleId),
    [search, selectedDepartmentId, selectedRoleId]
  );

  // For the empty state's "library is brand new" detection, we want to
  // know if there are ZERO SOPs library-wide, regardless of filter. When
  // the user has filters applied, the SOP count we have reflects only
  // filtered results. Cheap heuristic: when filters are off and the result
  // is 0, the library is empty.
  const totalAcrossLibrary = isFiltered ? Infinity : sops.length;

  return (
    <div style={{ padding: "24px 24px 80px", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <BookOpen size={20} style={{ color: "var(--accent)" }} />
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            SOPs
          </h1>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Standard operating procedures, organized by department and role. Search, filter, or share by URL.
        </p>
      </div>

      {/* Filter bar */}
      <SopFilterBar
        departments={departments}
        roles={roles}
        search={search}
        selectedDepartmentId={selectedDepartmentId}
        selectedRoleId={selectedRoleId}
        onSearchChange={setSearch}
        onDepartmentChange={setSelectedDepartmentId}
        onRoleChange={setSelectedRoleId}
        onUploadClick={() => setUploadOpen(true)}
        onManageTaxonomyClick={() => setTaxonomyOpen(true)}
        permissions={{ canUpload: isAdmin, canManage: isAdmin }}
        totalCount={sops.length}
      />

      {/* Body */}
      {loading ? (
        <div className="glass-static" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13, borderRadius: 12 }}>
          Loading SOPs...
        </div>
      ) : error ? (
        <div
          style={{
            padding: 20,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : sops.length === 0 ? (
        <SopEmptyState
          isFiltered={isFiltered}
          totalSopsAcrossLibrary={totalAcrossLibrary}
          onUploadClick={() => setUploadOpen(true)}
          permissions={{ canUpload: isAdmin, canManage: isAdmin }}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {sops.map((s) => (
            <SopCard key={s.id} sop={s} />
          ))}
        </div>
      )}

      {/* Modals */}
      <SopUploadModal
        open={uploadOpen}
        departments={departments}
        roles={roles}
        onClose={() => setUploadOpen(false)}
        onUploaded={loadAll}
      />
      <SopTaxonomyModal
        open={taxonomyOpen}
        departments={departments}
        roles={roles}
        onClose={() => setTaxonomyOpen(false)}
        onChanged={loadAll}
      />
    </div>
  );
}

function buildSopUrl(
  search: string,
  departmentId: number | null,
  roleId: number | null
): string {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (departmentId) params.set("department", String(departmentId));
  if (roleId) params.set("role", String(roleId));
  return `/api/sop${params.toString() ? `?${params.toString()}` : ""}`;
}
