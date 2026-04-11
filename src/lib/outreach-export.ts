export interface ColdDmsRow {
  username: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  instagramLink: string;
}

function clean(value?: string | null): string {
  return (value || "").trim();
}

export function normalizeInstagramUsername(value?: string | null): string {
  return clean(value).replace(/^@+/, "");
}

export function buildColdDmsRow(params: {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  instagramLink?: string | null;
}): ColdDmsRow | null {
  const username = normalizeInstagramUsername(params.username);
  if (!username) return null;

  const firstName = clean(params.firstName);
  const lastName = clean(params.lastName);
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const instagramLink =
    clean(params.instagramLink) || `https://instagram.com/${username}`;

  return {
    username,
    firstName,
    lastName,
    name,
    email: clean(params.email),
    instagramLink,
  };
}

function csvValue(value: string): string {
  const cleanValue = value.replace(/"/g, '""');
  return `"${cleanValue}"`;
}

export function buildColdDmsCsv(rows: ColdDmsRow[]): string {
  const header = [
    "username",
    "firstName",
    "lastName",
    "name",
    "email",
    "instagramLink",
  ];
  const body = rows.map((row) =>
    [
      row.username,
      row.firstName,
      row.lastName,
      row.name,
      row.email,
      row.instagramLink,
    ]
      .map(csvValue)
      .join(",")
  );

  return [header.join(","), ...body].join("\n");
}

export function mergeColdDmsRows(...rowLists: Array<ColdDmsRow[] | undefined>): ColdDmsRow[] {
  const rowsByKey = new Map<string, ColdDmsRow>();

  for (const rowList of rowLists) {
    for (const row of rowList || []) {
      const username = normalizeInstagramUsername(row.username);
      if (!username) continue;

      const normalizedRow: ColdDmsRow = {
        username,
        firstName: clean(row.firstName),
        lastName: clean(row.lastName),
        name: clean(row.name) || [clean(row.firstName), clean(row.lastName)].filter(Boolean).join(" "),
        email: clean(row.email),
        instagramLink: clean(row.instagramLink) || `https://instagram.com/${username}`,
      };

      const key = username.toLowerCase();
      const existing = rowsByKey.get(key);

      if (!existing) {
        rowsByKey.set(key, normalizedRow);
        continue;
      }

      rowsByKey.set(key, {
        username,
        firstName: existing.firstName || normalizedRow.firstName,
        lastName: existing.lastName || normalizedRow.lastName,
        name: existing.name || normalizedRow.name,
        email: existing.email || normalizedRow.email,
        instagramLink: existing.instagramLink || normalizedRow.instagramLink,
      });
    }
  }

  return Array.from(rowsByKey.values());
}
