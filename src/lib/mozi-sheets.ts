import { google } from "googleapis";

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars"
    );
  }

  // Environment variables often store \n as literal two-char sequences
  const privateKey = rawKey.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

const sheets = () => google.sheets({ version: "v4", auth: getAuth() });

/**
 * Read a range from a Google Sheet and return rows as string[][].
 */
export async function getSheetData(
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const response = await sheets().spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return (response.data.values as string[][]) ?? [];
}

/**
 * Get all tab (sheet) names in a spreadsheet.
 */
export async function getAllSheetTabs(
  spreadsheetId: string
): Promise<string[]> {
  const response = await sheets().spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  return (
    response.data.sheets?.map((s) => s.properties?.title ?? "") ?? []
  );
}
